/**
 * Cross-device sync: append-only replication of the desktop's orchestration
 * events into an org-scoped log with per-device cursors, plus content-addressed
 * attachments. Opt-in per device; storage is bounded by the plan quota; the
 * `sync` kill switch stops writes but never reads.
 */
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";

import type { Principal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";
import type { BlobStore } from "./BlobStore.ts";

export interface SyncEventInput {
  readonly eventId: string;
  readonly aggregateKind: string;
  readonly streamId: string;
  readonly streamVersion: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly commandId?: string | null;
  readonly causationEventId?: string | null;
  readonly correlationId?: string | null;
  readonly actorKind: string;
  readonly payload: unknown;
  readonly metadata?: unknown;
}

const MAX_EVENTS_PER_PUSH = 500;
const MAX_EVENT_BYTES = 512 * 1024;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const PULL_LIMIT = 500;

export class SyncService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly blobs: BlobStore,
  ) {}

  private async assertWritable(): Promise<void> {
    const row = await this.db.query.killSwitches.findFirst({
      where: eq(schema.killSwitches.name, "sync"),
    });
    if (row?.engaged) throw new ApiError(503, "sync_paused", "Sync is temporarily paused.");
  }

  private async device(principal: Principal, deviceId: string) {
    const device = await this.db.query.devices.findFirst({
      where: and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, principal.userId)),
    });
    if (!device || device.trustState !== "trusted")
      throw new ApiError(403, "unknown_device", "Register this device before syncing.");
    return device;
  }

  private async quota(orgId: string): Promise<{ readonly used: bigint; readonly limit: bigint }> {
    const usage = await this.db.query.syncUsage.findFirst({
      where: eq(schema.syncUsage.orgId, orgId),
    });
    const sub = await this.db.query.subscriptions.findFirst({
      where: and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, "active")),
    });
    const plan = await this.db.query.plans.findFirst({
      where: eq(schema.plans.id, sub?.planId ?? "trial"),
    });
    return {
      used: (usage?.eventBytes ?? 0n) + (usage?.attachmentBytes ?? 0n),
      limit: plan?.syncQuotaBytes ?? 100n * 1024n * 1024n,
    };
  }

  async setDeviceSync(principal: Principal, deviceId: string, enabled: boolean) {
    await this.device(principal, deviceId);
    await this.db
      .update(schema.devices)
      .set({ syncEnabled: enabled })
      .where(eq(schema.devices.id, deviceId));
    return { deviceId, syncEnabled: enabled };
  }

  async status(principal: Principal, deviceId: string) {
    const device = await this.device(principal, deviceId);
    const cursor = await this.db.query.deviceCursors.findFirst({
      where: eq(schema.deviceCursors.deviceId, deviceId),
    });
    const [head] = await this.db.execute<{ head: string | null }>(
      sql`SELECT max(sequence)::text AS head FROM thread_events WHERE org_id = ${principal.orgId}`,
    );
    const q = await this.quota(principal.orgId);
    return {
      deviceId,
      syncEnabled: device.syncEnabled,
      pulledThrough: (cursor?.pulledThrough ?? 0n).toString(),
      head: head?.head ?? "0",
      lastSyncAt: cursor?.lastSyncAt ?? null,
      quota: { usedBytes: q.used.toString(), limitBytes: q.limit.toString() },
    };
  }

  /** Append events. Duplicate event ids are ignored so the client can retry a batch. */
  async push(principal: Principal, deviceId: string, events: readonly SyncEventInput[]) {
    await this.assertWritable();
    const device = await this.device(principal, deviceId);
    if (!device.syncEnabled)
      throw new ApiError(403, "sync_disabled", "Turn on sync for this device first.");
    if (events.length === 0 || events.length > MAX_EVENTS_PER_PUSH)
      throw new ApiError(400, "bad_request", `Push 1 to ${MAX_EVENTS_PER_PUSH} events.`);
    const rows = events.map((e) => {
      const sizeBytes =
        Buffer.byteLength(JSON.stringify(e.payload ?? null)) +
        Buffer.byteLength(JSON.stringify(e.metadata ?? null));
      if (sizeBytes > MAX_EVENT_BYTES)
        throw new ApiError(
          413,
          "event_too_large",
          `Event ${e.eventId} exceeds ${MAX_EVENT_BYTES} bytes.`,
        );
      if (!e.eventId || !e.streamId || !e.eventType || !Number.isInteger(e.streamVersion))
        throw new ApiError(400, "bad_event", `Event ${e.eventId || "?"} is malformed.`);
      return {
        orgId: principal.orgId,
        originDeviceId: deviceId,
        eventId: e.eventId,
        aggregateKind: e.aggregateKind,
        streamId: e.streamId,
        streamVersion: e.streamVersion,
        eventType: e.eventType,
        occurredAt: new Date(e.occurredAt),
        commandId: e.commandId ?? null,
        causationEventId: e.causationEventId ?? null,
        correlationId: e.correlationId ?? null,
        actorKind: e.actorKind,
        payload: e.payload ?? null,
        metadata: e.metadata ?? null,
        sizeBytes,
      };
    });
    const total = rows.reduce((acc, r) => acc + r.sizeBytes, 0);
    const q = await this.quota(principal.orgId);
    if (q.used + BigInt(total) > q.limit)
      throw new ApiError(
        402,
        "sync_quota_exceeded",
        "Sync storage quota reached. Upgrade or delete old threads.",
      );

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.threadEvents)
        .values(rows)
        .onConflictDoNothing({ target: [schema.threadEvents.orgId, schema.threadEvents.eventId] })
        .returning({
          sequence: schema.threadEvents.sequence,
          eventId: schema.threadEvents.eventId,
          streamId: schema.threadEvents.streamId,
          sizeBytes: schema.threadEvents.sizeBytes,
          occurredAt: schema.threadEvents.occurredAt,
          eventType: schema.threadEvents.eventType,
          payload: schema.threadEvents.payload,
          aggregateKind: schema.threadEvents.aggregateKind,
        });
      const bytes = inserted.reduce((acc, r) => acc + r.sizeBytes, 0);
      if (bytes > 0) {
        await tx
          .insert(schema.syncUsage)
          .values({ orgId: principal.orgId, eventBytes: BigInt(bytes) })
          .onConflictDoUpdate({
            target: schema.syncUsage.orgId,
            set: {
              eventBytes: sql`${schema.syncUsage.eventBytes} + ${bytes}`,
              updatedAt: new Date(),
            },
          });
      }
      // Maintain the thread index from thread-aggregate events.
      for (const r of inserted) {
        if (r.aggregateKind !== "thread") continue;
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        const title = typeof payload.title === "string" ? payload.title : undefined;
        const selection = payload.modelSelection as
          | { provider?: string; model?: string }
          | undefined;
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        const archived =
          r.eventType === "thread.archived"
            ? true
            : r.eventType === "thread.unarchived"
              ? false
              : undefined;
        const deleted = r.eventType === "thread.deleted" ? true : undefined;
        await tx
          .insert(schema.threadIndex)
          .values({
            orgId: principal.orgId,
            threadId: r.streamId,
            projectId: projectId ?? null,
            title: title ?? null,
            provider: selection?.provider ?? null,
            model: selection?.model ?? null,
            lastEventSequence: r.sequence,
            lastEventAt: r.occurredAt,
            archived: archived ?? false,
            deleted: deleted ?? false,
            eventCount: 1,
          })
          .onConflictDoUpdate({
            target: [schema.threadIndex.orgId, schema.threadIndex.threadId],
            set: {
              lastEventSequence: sql`greatest(${schema.threadIndex.lastEventSequence}, ${r.sequence})`,
              lastEventAt: sql`greatest(${schema.threadIndex.lastEventAt}, ${r.occurredAt.toISOString()}::timestamptz)`,
              eventCount: sql`${schema.threadIndex.eventCount} + 1`,
              ...(title !== undefined ? { title } : {}),
              ...(projectId !== undefined ? { projectId } : {}),
              ...(selection?.provider ? { provider: selection.provider } : {}),
              ...(selection?.model ? { model: selection.model } : {}),
              ...(archived !== undefined ? { archived } : {}),
              ...(deleted !== undefined ? { deleted } : {}),
            },
          });
      }
      await tx
        .insert(schema.deviceCursors)
        .values({
          deviceId,
          orgId: principal.orgId,
          lastPushedEventId: events.at(-1)!.eventId,
          lastSyncAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.deviceCursors.deviceId,
          set: { lastPushedEventId: events.at(-1)!.eventId, lastSyncAt: new Date() },
        });
      await tx
        .update(schema.devices)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.devices.id, deviceId));
      const head = inserted.length
        ? inserted.reduce((m, r) => (r.sequence > m ? r.sequence : m), 0n)
        : null;
      return {
        accepted: inserted.length,
        duplicates: events.length - inserted.length,
        head: head?.toString() ?? null,
      };
    });
  }

  /** Events after the cursor, excluding the device's own pushes unless `includeOwn`. Advances the cursor. */
  async pull(
    principal: Principal,
    deviceId: string,
    cursor: bigint,
    options: { readonly includeOwn?: boolean; readonly limit?: number } = {},
  ) {
    await this.device(principal, deviceId);
    const limit = Math.min(Math.max(options.limit ?? PULL_LIMIT, 1), PULL_LIMIT);
    const rows = await this.db
      .select()
      .from(schema.threadEvents)
      .where(
        and(
          eq(schema.threadEvents.orgId, principal.orgId),
          gt(schema.threadEvents.sequence, cursor),
        ),
      )
      .orderBy(asc(schema.threadEvents.sequence))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const events = page
      .filter((r) => options.includeOwn || r.originDeviceId !== deviceId)
      .map((r) => ({
        sequence: r.sequence.toString(),
        eventId: r.eventId,
        aggregateKind: r.aggregateKind,
        streamId: r.streamId,
        streamVersion: r.streamVersion,
        eventType: r.eventType,
        occurredAt: r.occurredAt.toISOString(),
        commandId: r.commandId,
        causationEventId: r.causationEventId,
        correlationId: r.correlationId,
        actorKind: r.actorKind,
        payload: r.payload,
        metadata: r.metadata,
        originDeviceId: r.originDeviceId,
      }));
    const next = page.at(-1)?.sequence ?? cursor;
    await this.db
      .insert(schema.deviceCursors)
      .values({ deviceId, orgId: principal.orgId, pulledThrough: next, lastSyncAt: new Date() })
      .onConflictDoUpdate({
        target: schema.deviceCursors.deviceId,
        set: {
          pulledThrough: sql`greatest(${schema.deviceCursors.pulledThrough}, ${next})`,
          lastSyncAt: new Date(),
        },
      });
    return { events, cursor: next.toString(), hasMore: rows.length > limit };
  }

  async listThreads(principal: Principal, limit = 100) {
    return this.db.query.threadIndex.findMany({
      where: and(
        eq(schema.threadIndex.orgId, principal.orgId),
        eq(schema.threadIndex.deleted, false),
      ),
      orderBy: (t, { desc }) => [desc(t.lastEventAt)],
      limit: Math.min(limit, 500),
    });
  }

  async threadEvents(principal: Principal, threadId: string) {
    return this.db
      .select()
      .from(schema.threadEvents)
      .where(
        and(
          eq(schema.threadEvents.orgId, principal.orgId),
          eq(schema.threadEvents.streamId, threadId),
        ),
      )
      .orderBy(asc(schema.threadEvents.sequence));
  }

  // ---- attachments ---------------------------------------------------------

  async beginAttachmentUpload(
    principal: Principal,
    input: { readonly contentHash: string; readonly mimeType: string; readonly sizeBytes: number },
  ) {
    await this.assertWritable();
    if (!/^[0-9a-f]{64}$/.test(input.contentHash))
      throw new ApiError(400, "bad_hash", "contentHash must be a sha256 hex digest.");
    if (
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > MAX_ATTACHMENT_BYTES
    )
      throw new ApiError(413, "attachment_too_large", "Attachments are limited to 50 MB.");
    const existing = await this.db.query.attachments.findFirst({
      where: and(
        eq(schema.attachments.orgId, principal.orgId),
        eq(schema.attachments.contentHash, input.contentHash),
      ),
    });
    if (existing?.status === "ready")
      return { alreadyPresent: true as const, contentHash: input.contentHash };
    const q = await this.quota(principal.orgId);
    if (q.used + BigInt(input.sizeBytes) > q.limit)
      throw new ApiError(402, "sync_quota_exceeded", "Sync storage quota reached.");
    const bucketKey = `orgs/${principal.orgId}/attachments/${input.contentHash}`;
    await this.db
      .insert(schema.attachments)
      .values({
        orgId: principal.orgId,
        contentHash: input.contentHash,
        bucketKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedBy: principal.userId,
        status: "pending",
      })
      .onConflictDoNothing({ target: [schema.attachments.orgId, schema.attachments.contentHash] });
    const upload = await this.blobs.presignUpload(bucketKey, input.mimeType, input.sizeBytes);
    return { alreadyPresent: false as const, contentHash: input.contentHash, upload };
  }

  async completeAttachmentUpload(principal: Principal, contentHash: string) {
    const row = await this.db.query.attachments.findFirst({
      where: and(
        eq(schema.attachments.orgId, principal.orgId),
        eq(schema.attachments.contentHash, contentHash),
      ),
    });
    if (!row) throw new ApiError(404, "not_found", "Start the upload first.");
    if (row.status === "ready") return { status: "ready" as const };
    const head = await this.blobs.head(row.bucketKey);
    if (!head || head.sizeBytes !== row.sizeBytes)
      throw new ApiError(
        409,
        "upload_incomplete",
        "The object is missing or its size does not match.",
      );
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.attachments)
        .set({ status: "ready" })
        .where(
          and(
            eq(schema.attachments.orgId, principal.orgId),
            eq(schema.attachments.contentHash, contentHash),
          ),
        );
      await tx
        .insert(schema.syncUsage)
        .values({ orgId: principal.orgId, attachmentBytes: BigInt(row.sizeBytes) })
        .onConflictDoUpdate({
          target: schema.syncUsage.orgId,
          set: {
            attachmentBytes: sql`${schema.syncUsage.attachmentBytes} + ${row.sizeBytes}`,
            updatedAt: new Date(),
          },
        });
    });
    return { status: "ready" as const };
  }

  async attachmentDownload(principal: Principal, contentHash: string) {
    const row = await this.db.query.attachments.findFirst({
      where: and(
        eq(schema.attachments.orgId, principal.orgId),
        eq(schema.attachments.contentHash, contentHash),
        eq(schema.attachments.status, "ready"),
      ),
    });
    if (!row) throw new ApiError(404, "not_found", "Attachment not found.");
    return {
      ...(await this.blobs.presignDownload(row.bucketKey)),
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    };
  }
}

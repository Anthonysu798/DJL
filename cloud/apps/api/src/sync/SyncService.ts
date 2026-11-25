/**
 * Cross-device sync: append-only replication of the desktop's orchestration
 * events into the user's personal-org log with per-device cursors, plus content-addressed
 * attachments. Opt-in per device; storage is bounded by the plan quota; the
 * `sync` kill switch stops writes but never reads.
 */
import { createHash } from "node:crypto";

import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";

import type { Principal } from "../auth/guard.ts";
import { isSupportedType } from "../files/fileTypes.ts";
import { ApiError } from "../http/errors.ts";
import type { BlobStore } from "./BlobStore.ts";

/**
 * Synced desktop history is personal: it always lives in the caller's personal org, never
 * a team org, so teammates (any role) cannot read or rewrite each other's conversations.
 */
function ownSyncScope(principal: Principal): Principal {
  return principal.orgId === principal.personalOrgId
    ? principal
    : { ...principal, orgId: principal.personalOrgId };
}

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
/** A presigned PUT lasts ten minutes; a pending upload this old was abandoned. */
const PENDING_UPLOAD_TTL_MS = 60 * 60_000;

/** The file upload types plus opaque binary. Never HTML, SVG, XML, or script. */
const isAttachmentType = (mimeType: string) =>
  mimeType === "application/octet-stream" || isSupportedType(mimeType);

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

  private async quota(
    orgId: string,
    db: Pick<DjlDatabase, "query"> = this.db,
  ): Promise<{ readonly used: bigint; readonly limit: bigint }> {
    const usage = await db.query.syncUsage.findFirst({
      where: eq(schema.syncUsage.orgId, orgId),
    });
    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, "active")),
    });
    const plan = await db.query.plans.findFirst({
      where: eq(schema.plans.id, sub?.planId ?? "trial"),
    });
    return {
      used: (usage?.eventBytes ?? 0n) + (usage?.attachmentBytes ?? 0n),
      limit: plan?.syncQuotaBytes ?? 100n * 1024n * 1024n,
    };
  }

  async setDeviceSync(principal: Principal, deviceId: string, enabled: boolean) {
    principal = ownSyncScope(principal);
    await this.device(principal, deviceId);
    await this.db
      .update(schema.devices)
      .set({ syncEnabled: enabled })
      .where(eq(schema.devices.id, deviceId));
    return { deviceId, syncEnabled: enabled };
  }

  async status(principal: Principal, deviceId: string) {
    principal = ownSyncScope(principal);
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
    principal = ownSyncScope(principal);
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
    principal = ownSyncScope(principal);
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
    principal = ownSyncScope(principal);
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
    principal = ownSyncScope(principal);
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
    principal = ownSyncScope(principal);
    await this.assertWritable();
    if (!/^[0-9a-f]{64}$/.test(input.contentHash))
      throw new ApiError(400, "bad_hash", "contentHash must be a sha256 hex digest.");
    if (
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > MAX_ATTACHMENT_BYTES
    )
      throw new ApiError(413, "attachment_too_large", "Attachments are limited to 50 MB.");
    if (!isAttachmentType(input.mimeType))
      throw new ApiError(400, "unsupported_type", "This attachment type is not supported.");
    const { orgId } = principal;
    const pendingElsewhere = and(
      eq(schema.attachments.orgId, orgId),
      eq(schema.attachments.status, "pending"),
      ne(schema.attachments.contentHash, input.contentHash),
    );
    // Clients only ever get a PUT for this key; verified bytes move to another on completion.
    const bucketKey = `orgs/${orgId}/attachments/${input.contentHash}`;
    let abandoned: readonly { readonly bucketKey: string }[] = [];
    const alreadyPresent = await this.db.transaction(async (tx) => {
      // One upload starts at a time per org, so parallel starts cannot each fit under the quota.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sync-attachments:${orgId}`}))`);
      const existing = await tx.query.attachments.findFirst({
        where: and(
          eq(schema.attachments.orgId, orgId),
          eq(schema.attachments.contentHash, input.contentHash),
        ),
      });
      if (existing?.status === "ready") return true;
      abandoned = await tx
        .delete(schema.attachments)
        .where(
          and(
            pendingElsewhere,
            lt(schema.attachments.createdAt, new Date(Date.now() - PENDING_UPLOAD_TTL_MS)),
          ),
        )
        .returning({ bucketKey: schema.attachments.bucketKey });
      // Uploads that were started but not completed hold their bytes against the quota.
      const [pending] = await tx
        .select({ bytes: sql<string>`coalesce(sum(${schema.attachments.sizeBytes}), 0)` })
        .from(schema.attachments)
        .where(pendingElsewhere);
      const q = await this.quota(orgId, tx);
      if (q.used + BigInt(pending!.bytes) + BigInt(input.sizeBytes) > q.limit)
        throw new ApiError(402, "sync_quota_exceeded", "Sync storage quota reached.");
      const declared = {
        bucketKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedBy: principal.userId,
      };
      await tx
        .insert(schema.attachments)
        .values({ orgId, contentHash: input.contentHash, status: "pending", ...declared })
        .onConflictDoUpdate({
          target: [schema.attachments.orgId, schema.attachments.contentHash],
          // The latest declaration wins, so a wrong size filed by someone else cannot block the hash.
          set: { ...declared, createdAt: new Date() },
          setWhere: eq(schema.attachments.status, "pending"),
        });
      return false;
    });
    await Promise.allSettled(abandoned.map((row) => this.blobs.remove(row.bucketKey)));
    if (alreadyPresent) return { alreadyPresent: true as const, contentHash: input.contentHash };
    const upload = await this.blobs.presignUpload(bucketKey, input.mimeType, input.sizeBytes);
    return { alreadyPresent: false as const, contentHash: input.contentHash, upload };
  }

  async completeAttachmentUpload(principal: Principal, contentHash: string) {
    principal = ownSyncScope(principal);
    const mine = and(
      eq(schema.attachments.orgId, principal.orgId),
      eq(schema.attachments.contentHash, contentHash),
    );
    const row = await this.db.query.attachments.findFirst({ where: mine });
    if (!row) throw new ApiError(404, "not_found", "Start the upload first.");
    if (row.status === "ready") return { status: "ready" as const };
    const head = await this.blobs.head(row.bucketKey);
    if (!head || head.sizeBytes !== row.sizeBytes)
      throw new ApiError(
        409,
        "upload_incomplete",
        "The object is missing or its size does not match.",
      );
    // The hash names the content for the whole org: bytes that do not match it are thrown away.
    const bytes = await this.blobs.read(row.bucketKey, row.sizeBytes);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== contentHash) {
      await this.blobs.remove(row.bucketKey);
      await this.db
        .delete(schema.attachments)
        .where(and(mine, eq(schema.attachments.status, "pending")));
      throw new ApiError(
        400,
        "upload_mismatch",
        "The uploaded bytes do not match the declared hash.",
      );
    }
    // The upload URL stays valid for minutes and could replace the object after this check,
    // so the verified bytes are stored under a key no client is ever given a PUT for.
    const bucketKey = `orgs/${principal.orgId}/verified-attachments/${contentHash}`;
    await this.blobs.write(bucketKey, bytes, "application/octet-stream");
    await this.db.transaction(async (tx) => {
      const claimed = await tx
        .update(schema.attachments)
        .set({ status: "ready", bucketKey })
        .where(and(mine, eq(schema.attachments.status, "pending")))
        .returning({ sizeBytes: schema.attachments.sizeBytes });
      if (claimed.length === 0) return; // a concurrent completion already counted it
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
    await this.blobs.remove(row.bucketKey);
    return { status: "ready" as const };
  }

  async attachmentDownload(principal: Principal, contentHash: string) {
    principal = ownSyncScope(principal);
    const row = await this.db.query.attachments.findFirst({
      where: and(
        eq(schema.attachments.orgId, principal.orgId),
        eq(schema.attachments.contentHash, contentHash),
        eq(schema.attachments.status, "ready"),
      ),
    });
    if (!row) throw new ApiError(404, "not_found", "Attachment not found.");
    return {
      // Served as a download with an inert type: the storage host must never render user bytes.
      ...(await this.blobs.presignDownload(row.bucketKey, 600, true)),
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    };
  }
}

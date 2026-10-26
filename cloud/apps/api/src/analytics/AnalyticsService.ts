import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  parseAnalyticsBatch,
  parseAnalyticsInstallation,
  type AnalyticsInstallation,
} from "@synara/contracts/cloud";
import type { Principal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";

const {
  analyticsInstallations: installations,
  analyticsEvents: events,
  analyticsDailyActivity: daily,
} = schema;
type Transaction = Parameters<Parameters<DjlDatabase["transaction"]>[0]>[0];
const hash = (credential: string) => createHash("sha256").update(credential).digest("hex");
const invalid = () => new ApiError(400, "invalid_analytics", "Invalid analytics report.");
export async function deleteAnalyticsForUser(
  userId: string,
  tx: Pick<Transaction, "delete">,
): Promise<void> {
  await tx.delete(events).where(eq(events.userId, userId));
  await tx.delete(daily).where(eq(daily.userId, userId));
}
function parse<T>(decoder: (value: unknown) => T, input: unknown): T {
  try {
    return decoder(input);
  } catch {
    throw invalid();
  }
}

export class AnalyticsService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly clock: { now: () => Date } = { now: () => new Date() },
  ) {}

  async register(input: unknown): Promise<{ installationId: string; credential: string }> {
    const metadata = parse(parseAnalyticsInstallation, input);
    const credential = randomBytes(32).toString("base64url");
    const inserted = await this.db
      .insert(installations)
      .values({
        id: metadata.installationId,
        credentialHash: hash(credential),
        platform: metadata.platform,
        appVersion: metadata.appVersion,
        osVersion: metadata.osVersion,
        channel: metadata.channel,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: installations.id });
    if (!inserted.length)
      throw new ApiError(409, "installation_exists", "Installation is already registered.");
    return { installationId: metadata.installationId, credential };
  }

  async updateMetadata(credential: string, input: unknown): Promise<void> {
    const metadata: AnalyticsInstallation = parse(parseAnalyticsInstallation, input);
    const updated = await this.db
      .update(installations)
      .set({ appVersion: metadata.appVersion, osVersion: metadata.osVersion })
      .where(
        sql`${installations.credentialHash} = ${hash(credential)} AND ${installations.id} = ${metadata.installationId} AND ${installations.platform} = ${metadata.platform} AND ${installations.channel} = ${metadata.channel}`,
      )
      .returning({ id: installations.id });
    if (!updated.length)
      throw new ApiError(401, "installation_required", "Valid installation credential required.");
  }

  async ingest(
    credential: string,
    principal: Principal | null,
    input: unknown,
  ): Promise<{ accepted: number }> {
    if (principal?.banned) throw new ApiError(403, "suspended", "This account is suspended.");
    const batch = parse(parseAnalyticsBatch, input);
    const now = this.clock.now();
    const dated = batch.events.map((event) => {
      const occurredAt = new Date(event.occurredAt);
      if (
        !Number.isFinite(occurredAt.getTime()) ||
        occurredAt.getTime() > now.getTime() + 300_000 ||
        occurredAt.getTime() < now.getTime() - 7 * 86_400_000 ||
        ![occurredAt.toISOString(), occurredAt.toISOString().replace(".000Z", "Z")].includes(
          event.occurredAt,
        )
      )
        throw invalid();
      return { event, occurredAt };
    });
    return this.db.transaction(async (tx) => {
      const [install] = await tx
        .select()
        .from(installations)
        .where(eq(installations.credentialHash, hash(credential)))
        .for("update");
      if (!install)
        throw new ApiError(401, "installation_required", "Valid installation credential required.");
      let accepted = 0;
      for (const { event, occurredAt } of dated) {
        const feature = event.kind === "feature_used" ? event.feature : null;
        const [inserted] = await tx
          .insert(events)
          .values({
            id: event.eventId,
            installationId: install.id,
            userId: principal?.userId ?? null,
            sessionId: event.sessionId,
            kind: event.kind,
            feature,
            platform: install.platform,
            appVersion: install.appVersion,
            channel: install.channel,
            occurredAt,
            receivedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: events.id });
        if (!inserted) {
          const existing = await tx.query.analyticsEvents.findFirst({
            where: eq(events.id, event.eventId),
          });
          if (
            !existing ||
            existing.installationId !== install.id ||
            existing.kind !== event.kind ||
            existing.feature !== feature ||
            existing.sessionId.toLowerCase() !== event.sessionId.toLowerCase() ||
            existing.occurredAt.getTime() !== occurredAt.getTime()
          )
            throw new ApiError(
              409,
              "analytics_event_conflict",
              "The event ID was already used for another report.",
            );
          continue;
        }
        accepted++;
        if (event.kind === "session_end") continue;
        const actorKey = principal ? `user:${principal.userId}` : `installation:${install.id}`;
        await tx
          .insert(daily)
          .values({
            day: event.occurredAt.slice(0, 10),
            installationId: install.id,
            actorKey,
            userId: principal?.userId ?? null,
            feature: feature ?? "app",
            platform: install.platform,
            appVersion: install.appVersion,
            channel: install.channel,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt,
          })
          .onConflictDoUpdate({
            target: [
              daily.day,
              daily.installationId,
              daily.actorKey,
              daily.feature,
              daily.appVersion,
            ],
            set: {
              events: sql`${daily.events} + 1`,
              firstSeenAt: sql`least(${daily.firstSeenAt}, ${occurredAt.toISOString()}::timestamptz)`,
              lastSeenAt: sql`greatest(${daily.lastSeenAt}, ${occurredAt.toISOString()}::timestamptz)`,
            },
          });
        await tx
          .update(installations)
          .set({
            lastSeenAt: sql`greatest(${installations.lastSeenAt}, ${occurredAt.toISOString()}::timestamptz)`,
            ...(event.kind === "first_open"
              ? {
                  firstOpenedAt: sql`least(coalesce(${installations.firstOpenedAt}, ${occurredAt.toISOString()}::timestamptz), ${occurredAt.toISOString()}::timestamptz)`,
                }
              : {}),
          })
          .where(eq(installations.id, install.id));
      }
      return { accepted };
    });
  }

  async deleteUserActivity(userId: string, tx: Transaction): Promise<void> {
    await deleteAnalyticsForUser(userId, tx);
  }
}

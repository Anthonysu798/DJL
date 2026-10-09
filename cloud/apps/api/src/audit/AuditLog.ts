/**
 * Insert-only audit trail. Called inside the same transaction as the change
 * it records whenever possible (pass `tx`), otherwise on the shared db.
 */
import { schema, type DjlDatabase } from "@djl/db";

export interface AuditEventInput {
  readonly actorType: "admin" | "user" | "system" | "stripe";
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly ipHash?: string | null;
  readonly traceId?: string | null;
}

type Writer = Pick<DjlDatabase, "insert">;

export async function writeAudit(db: Writer, event: AuditEventInput): Promise<void> {
  await db.insert(schema.auditEvents).values({
    actorType: event.actorType,
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    before: jsonSafe(event.before ?? null),
    after: jsonSafe(event.after ?? null),
    reason: event.reason ?? null,
    ipHash: event.ipHash ?? null,
    traceId: event.traceId ?? null,
  });
}

/**
 * Audit values are stored as JSON, which has no bigint. Money is bigint
 * microcredits throughout, so bigints become decimal strings, at any depth.
 */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

/** SHA-256 of an IP with a static salt so audit rows never hold raw addresses. */
export async function hashIp(ip: string | null, salt: string): Promise<string | null> {
  if (!ip) return null;
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

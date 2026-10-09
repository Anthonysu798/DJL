import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/**
 * Two roles (decision 2026-09-13): `admin` runs the platform and the team,
 * `employee` handles support work. Permission sets live in AdminAuth.
 */
export const adminRoleEnum = pgEnum("admin_role", ["admin", "employee"]);

/**
 * Admin accounts are a separate population from users. Never share a table.
 * An invited employee has no password until they accept the invite; a soft
 * deleted one keeps its row for the audit trail but can never sign in again.
 */
export const admins = pgTable(
  "admins",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: adminRoleEnum("role").notNull(),
    /** Null until the invite is accepted. */
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    totpSecretEncrypted: text("totp_secret_encrypted"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    passkeyCredentials: jsonb("passkey_credentials").$type<readonly Record<string, unknown>[]>(),
    /** Employee credit grant cap in microcredits; null means role default. */
    creditGrantCapMicro: text("credit_grant_cap_micro"),
    disabled: boolean("disabled").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    lastLoginIp: text("last_login_ip"),
    createdAt: createdAt(),
    invitedBy: uuid("invited_by"),
  },
  (t) => [
    uniqueIndex("admins_email_live_uidx")
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Single-use, hashed invite tokens. A new invite supersedes the old one. */
export const adminInvites = pgTable(
  "admin_invites",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_invites_admin_idx").on(t.adminId)],
);

/**
 * Every admin sign-in attempt, successful or not, with everything the client
 * and the edge told us. This is the trail used when something goes wrong:
 * who, from where, on what device, and what the browser claimed about itself.
 */
export const adminLoginEvents = pgTable(
  "admin_login_events",
  {
    id: id(),
    adminId: uuid("admin_id").references(() => admins.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    /** success | bad_password | bad_totp | locked_out | disabled | ip_blocked | not_active | unknown_email */
    outcome: text("outcome").notNull(),
    ip: text("ip"),
    country: text("country"),
    userAgent: text("user_agent"),
    timezone: text("timezone"),
    locale: text("locale"),
    platform: text("platform"),
    screen: text("screen"),
    /** Client-generated stable id kept in the browser; the closest a web app gets to a hardware id. */
    deviceId: text("device_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("admin_login_events_admin_idx").on(t.adminId, t.createdAt),
    index("admin_login_events_ip_idx").on(t.ip),
    index("admin_login_events_created_idx").on(t.createdAt),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    ipHash: text("ip_hash").notNull(),
    userAgent: text("user_agent"),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("admin_sessions_admin_idx").on(t.adminId)],
);

/**
 * Insert-only audit trail. The application role has no UPDATE or DELETE on
 * this table (infra/supabase/policies.sql). Every admin mutation and every
 * external write records actor, action, target, before, after.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorType: text("actor_type").notNull(), // admin | user | system | stripe
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(), // e.g. admin.user.suspend, credits.grant, killswitch.gateway.on
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    reason: text("reason"),
    ipHash: text("ip_hash"),
    traceId: text("trace_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_target_idx").on(t.targetType, t.targetId),
    index("audit_events_actor_idx").on(t.actorType, t.actorId),
    index("audit_events_created_idx").on(t.createdAt),
  ],
);

export const killSwitchEnum = pgEnum("kill_switch", ["gateway", "billing", "sync"]);

export const killSwitches = pgTable("kill_switches", {
  name: killSwitchEnum("name").primaryKey(),
  engaged: boolean("engaged").notNull().default(false),
  reason: text("reason"),
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Pre-aggregated daily numbers for the admin dashboard. Rebuilt nightly by the worker. */
export const dailyStats = pgTable(
  "daily_stats",
  {
    day: text("day").notNull(), // YYYY-MM-DD UTC
    country: text("country").notNull().default("*"),
    signups: integer("signups").notNull().default(0),
    activeUsers: integer("active_users").notNull().default(0),
    gatewayRequests: integer("gateway_requests").notNull().default(0),
    settledMicro: text("settled_micro").notNull().default("0"),
    revenueUsdCents: integer("revenue_usd_cents").notNull().default(0),
    providerCostUsdMicro: text("provider_cost_usd_micro").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.country] })],
);

/** Global configuration knobs editable from admin (trial cap, priority weights, limits). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

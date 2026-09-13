import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const adminRoleEnum = pgEnum("admin_role", ["owner", "support", "finance", "readonly"]);

/** Admin accounts are a separate population from users. Never share a table. */
export const admins = pgTable("admins", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: adminRoleEnum("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEncrypted: text("totp_secret_encrypted"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  passkeyCredentials: jsonb("passkey_credentials").$type<readonly Record<string, unknown>[]>(),
  /** Support-role credit grant cap in microcredits; null means role default. */
  creditGrantCapMicro: text("credit_grant_cap_micro"),
  disabled: boolean("disabled").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  invitedBy: uuid("invited_by"),
});

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
  (t) => [index("daily_stats_day_country_idx").on(t.day, t.country)],
);

/** Global configuration knobs editable from admin (trial cap, priority weights, limits). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

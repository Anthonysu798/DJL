import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  primaryKey,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";
import { planIdEnum } from "./billing.ts";

const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const providerEnum = pgEnum("model_provider", ["openai", "anthropic", "openrouter"]);
export const modelStatusEnum = pgEnum("model_status", ["active", "degraded", "disabled"]);

/** Model catalog with user prices in microcredits. Admin-editable. */
export const modelCatalog = pgTable("model_catalog", {
  modelId: text("model_id").primaryKey(), // e.g. "gpt-5", "claude-opus-5", "openrouter/deepseek/..."
  provider: providerEnum("provider").notNull(),
  /** Model id sent upstream when it differs from our public id. */
  upstreamModelId: text("upstream_model_id").notNull(),
  displayName: text("display_name").notNull(),
  capabilities: jsonb("capabilities").$type<readonly string[]>().notNull(), // text.chat, tools, vision, json, image.generate, embeddings
  inputMicroPerToken: bigint("input_micro_per_token", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  outputMicroPerToken: bigint("output_micro_per_token", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  cachedInputMicroPerToken: bigint("cached_input_micro_per_token", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  microPerImage: bigint("micro_per_image", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  microPerRequest: bigint("micro_per_request", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  /** Provider list price in USD per million tokens, kept for margin reports. */
  providerInputUsdPerMillion: text("provider_input_usd_per_million"),
  providerOutputUsdPerMillion: text("provider_output_usd_per_million"),
  contextWindow: integer("context_window"),
  maxOutputTokens: integer("max_output_tokens"),
  qualityScore: integer("quality_score").notNull().default(50),
  status: modelStatusEnum("status").notNull().default("active"),
  region: text("region").notNull().default("global"),
  sortOrder: integer("sort_order").notNull().default(100),
  /** Cheap models the free weekly allowance may be spent on. */
  freeEligible: boolean("free_eligible").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const usageStatusEnum = pgEnum("usage_status", [
  "reserved",
  "streaming",
  "settled",
  "released",
  "cut_off",
  "failed",
]);

/** One row per gateway request. Never stores prompt or response content. */
export const usageRequests = pgTable(
  "usage_requests",
  {
    id: id(), // doubles as reservation id
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id),
    userId: uuid("user_id").references(() => user.id),
    deviceId: uuid("device_id"),
    modelId: text("model_id").notNull(),
    provider: providerEnum("provider").notNull(),
    endpoint: text("endpoint").notNull(), // chat.completions | images.generations | embeddings
    routeReason: text("route_reason").notNull(), // explicit | capability:<alias> | fallback:<from>
    status: usageStatusEnum("status").notNull(),
    reservedMicro: bigint("reserved_micro", { mode: "bigint" }).notNull(),
    settledMicro: bigint("settled_micro", { mode: "bigint" }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    images: integer("images"),
    upstreamRequestId: text("upstream_request_id"),
    refusal: boolean("refusal").notNull().default(false),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    firstTokenMs: integer("first_token_ms"),
    traceId: text("trace_id").notNull(),
    region: text("region").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("usage_requests_org_created_idx").on(t.orgId, t.createdAt),
    index("usage_requests_status_idx").on(t.status),
    index("usage_requests_user_idx").on(t.userId),
  ],
);

/** Registered client installs. iOS binds its Ed25519 identity here. */
export const devices = pgTable(
  "devices",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // desktop | web | ios
    name: text("name"),
    publicKey: text("public_key"), // Ed25519, iOS and desktop
    fingerprint: text("fingerprint").notNull(),
    trustState: text("trust_state").notNull().default("trusted"), // trusted | revoked
    syncEnabled: boolean("sync_enabled").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    appVersion: text("app_version"),
    platform: text("platform"),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("devices_user_idx").on(t.userId),
    index("devices_fingerprint_idx").on(t.fingerprint),
  ],
);

/** Abuse signals attached to a user or org for admin review. */
export const abuseFlags = pgTable(
  "abuse_flags",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // refusals | velocity | payment | manual
    severity: text("severity").notNull(), // info | warn | suspend
    details: jsonb("details").$type<Record<string, unknown>>(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: createdAt(),
  },
  (t) => [index("abuse_flags_user_idx").on(t.userId), index("abuse_flags_org_idx").on(t.orgId)],
);

/** APNs device tokens for run-finished notifications. */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    environment: text("environment").notNull(), // production | sandbox
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_tokens_token_idx").on(t.token),
    index("push_tokens_user_idx").on(t.userId),
  ],
);

// ---- usage windows and banked resets ---------------------------------------
//
// Credits still pay; windows cap how fast they are spent. Window spend is the
// sum of 5-minute buckets plus in-flight holds, ignoring anything before the
// user's floor (a reset) and, for the week, before the week anchor.

/** One row per user: where the current week starts and the reset floor. */
export const usageWindows = pgTable("usage_windows", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Start of the current 7-day week; a redeemed bank restarts it. */
  weekAnchorAt: timestamp("week_anchor_at", { withTimezone: true }).defaultNow().notNull(),
  /** Spend before this instant no longer counts toward either window. */
  floorAt: timestamp("floor_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

/** Settled spend per user in 5-minute buckets (`bucket_start` aligned to UTC). */
export const usageBuckets = pgTable(
  "usage_buckets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    spentMicro: bigint("spent_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bucketStart] }),
    index("usage_buckets_start_idx").on(t.bucketStart),
  ],
);

/** In-flight reservations counted against the windows until settled or released. */
export const usageHolds = pgTable(
  "usage_holds",
  {
    /** The gateway request (reservation) id. */
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("usage_holds_user_idx").on(t.userId),
    index("usage_holds_expires_idx").on(t.expiresAt),
  ],
);

export const resetBankSourceEnum = pgEnum("reset_bank_source", ["admin", "bulk", "plan_schedule"]);

/** One row per bulk or scheduled grant run of banked resets. */
export const resetGrantBatches = pgTable(
  "reset_grant_batches",
  {
    id: id(),
    source: resetBankSourceEnum("source").notNull(),
    /** Set for plan_schedule runs and plan-scoped bulk grants. */
    planId: planIdEnum("plan_id"),
    actor: text("actor").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"), // pending | running | done | failed
    grantedCount: integer("granted_count").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("reset_grant_batches_idempotency_idx").on(t.idempotencyKey)],
);

/** A banked reset a user can redeem once to zero both windows. Expires 90 days after grant. */
export const resetBanks = pgTable(
  "reset_banks",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: resetBankSourceEnum("source").notNull(),
    batchId: uuid("batch_id").references(() => resetGrantBatches.id),
    grantedBy: text("granted_by").notNull(),
    reason: text("reason"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    uniqueIndex("reset_banks_idempotency_idx").on(t.idempotencyKey),
    // Redeem locks the oldest live bank with FOR UPDATE SKIP LOCKED through this index.
    index("reset_banks_live_idx")
      .on(t.userId, t.grantedAt)
      .where(sql`${t.redeemedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    index("reset_banks_expires_idx").on(t.expiresAt),
  ],
);

/** Automatic bank grants per plan; the hourly job grants once per period. */
export const planResetSchedules = pgTable(
  "plan_reset_schedules",
  {
    id: id(),
    planId: planIdEnum("plan_id").notNull(),
    everyDays: integer("every_days").notNull(),
    banksPerGrant: integer("banks_per_grant").notNull().default(1),
    active: boolean("active").notNull().default(true),
    lastGrantedAt: timestamp("last_granted_at", { withTimezone: true }),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("plan_reset_schedules_plan_idx").on(t.planId)],
);

export const usageWindowEventKindEnum = pgEnum("usage_window_event_kind", [
  "bank_granted",
  "bank_redeemed",
  "bank_revoked",
  "bank_expired",
  "admin_reset",
  "reset_all",
]);

/** Append-only history of window resets and bank changes. `user_id` is null for reset-all. */
export const usageWindowEvents = pgTable(
  "usage_window_events",
  {
    id: id(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    kind: usageWindowEventKindEnum("kind").notNull(),
    bankId: uuid("bank_id").references(() => resetBanks.id),
    actor: text("actor").notNull(),
    reason: text("reason"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("usage_window_events_user_created_idx").on(t.userId, t.createdAt),
    index("usage_window_events_kind_idx").on(t.kind),
  ],
);

/** Per-use prices for agent tools (web search, page reads, sandbox time). Admin-editable. */
export const toolPrices = pgTable("tool_prices", {
  tool: text("tool").primaryKey(), // e.g. exa.search, exa.contents, sandbox.second
  unit: text("unit").notNull(), // call | second
  microPerUnit: bigint("micro_per_unit", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

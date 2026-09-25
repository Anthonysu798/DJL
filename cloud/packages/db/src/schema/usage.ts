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
  uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";

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

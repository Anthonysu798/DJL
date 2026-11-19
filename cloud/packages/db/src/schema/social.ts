import { pgTable, uuid, text, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"instagram" | "tiktok">().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    capabilities: jsonb("capabilities").$type<{ publish: boolean; metrics: boolean }>().notNull(),
    status: text("status").$type<"connected" | "disconnected">().notNull(),
    encryptedTokens: text("encrypted_tokens"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("social_accounts_owner_provider").on(
      t.userId,
      t.orgId,
      t.provider,
      t.providerAccountId,
    ),
  ],
);

export const socialOAuthAttempts = pgTable("social_oauth_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"instagram" | "tiktok">().notNull(),
  stateHash: text("state_hash").notNull().unique(),
  encryptedVerifier: text("encrypted_verifier").notNull(),
  threadId: text("thread_id").notNull(),
  campaignId: text("campaign_id").notNull(),
  revision: integer("revision").notNull(),
  reconnectAccountId: uuid("reconnect_account_id").references(() => socialAccounts.id),
  accountId: uuid("account_id").references(() => socialAccounts.id),
  status: text("status")
    .$type<"pending" | "processing" | "connected" | "failed" | "cancelled" | "expired">()
    .notNull(),
  errorCode: text("error_code"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

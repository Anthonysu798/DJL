/**
 * Entry point for the Better Auth CLI only (`bun run auth:generate`). It builds
 * the auth instance with local defaults and no-op notifiers so the CLI can read
 * the plugin schemas and emit packages/db/src/schema/auth.ts.
 */
import { createDatabase } from "@djl/db";
import { Redis } from "ioredis";

import { createAuth } from "./src/auth/auth.ts";
import { createSessionRevocations } from "./src/auth/revocations.ts";
import { loadApiEnv } from "./src/config/env.ts";

const env = loadApiEnv({ ...process.env, DJL_ENV: "local" });
const { db } = createDatabase(env.databaseUrl, { max: 1 });
const noop = async () => {};
// Never connects: the CLI only reads schemas.
const redis = new Redis(env.redisUrl, { lazyConnect: true });

export const auth = createAuth({
  env,
  db,
  notifier: {
    sendEmailOtp: noop,
    sendPhoneOtp: noop,
    sendPasswordReset: noop,
    sendOrganizationInvitation: noop,
    sendTwoFactorOtp: noop,
  },
  redis,
  revocations: createSessionRevocations(redis),
});

/**
 * Entry point for the Better Auth CLI only (`bun run auth:generate`). It builds
 * the auth instance with local defaults and no-op notifiers so the CLI can read
 * the plugin schemas and emit packages/db/src/schema/auth.ts.
 */
import { createDatabase } from "@djl/db";

import { createAuth } from "./src/auth/auth.ts";
import { loadApiEnv } from "./src/config/env.ts";

const env = loadApiEnv({ ...process.env, DJL_ENV: "local" });
const { db } = createDatabase(env.databaseUrl, { max: 1 });
const noop = async () => {};

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
});

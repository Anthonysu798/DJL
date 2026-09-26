/**
 * Composes env, database, auth, notifiers, and routes into a running HTTP
 * server. `startApi` returns the bound address and a close function so tests
 * can spin up a real server on an ephemeral port.
 */
import http from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { createDatabase } from "@djl/db";
import {
  MockOutbox,
  createResendSender,
  createTwilioSender,
  emailOtp,
  organizationInvite,
  passwordReset,
  type EmailSender,
  type SmsSender,
  type TeamAlertSender,
} from "@djl/notify";
import { Effect, Layer, Scope } from "effect";
import { Redis } from "ioredis";
import { HttpRouter } from "effect/unstable/http";

import { makeAccessTokenVerifier } from "./auth/accessTokens.ts";
import { createAuth, type AuthNotifier } from "./auth/auth.ts";
import { makePrincipalResolver } from "./auth/guard.ts";
import { makeLocaleLookup } from "./auth/locale.ts";
import { createSessionRevocations } from "./auth/revocations.ts";
import { BillingService } from "./billing/BillingService.ts";
import {
  FakeStripeGateway,
  createStripeGateway,
  type StripeGateway,
} from "./billing/StripeGateway.ts";
import { LedgerService } from "./credits/LedgerService.ts";
import { TrialService } from "./trial/TrialService.ts";
import { ADMIN_LOCKOUT, AdminAuth } from "./admin/AdminAuth.ts";
import { AdminService } from "./admin/AdminService.ts";
import { GatewayService } from "./gateway/GatewayService.ts";
import { FakeBlobStore, createS3BlobStore, type BlobStore } from "./sync/BlobStore.ts";
import { SyncService } from "./sync/SyncService.ts";
import { UsageAdminService } from "./usage/UsageAdminService.ts";
import { UsageService } from "./usage/UsageService.ts";
import { windowPolicy } from "./usage/windowPolicy.ts";
import { ChatService } from "./chat/ChatService.ts";
import { FileService } from "./files/FileService.ts";
import { ChatRunner } from "./runs/ChatRunner.ts";
import { createPgBossTaskQueue } from "./runs/RunExecutor.ts";
import { RunLog } from "./runs/RunLog.ts";
import { RunService } from "./runs/RunService.ts";
import { ShareService } from "./shares/ShareService.ts";
import { PushTokenService } from "./push/PushTokenService.ts";
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  type RateLimiter,
} from "./gateway/RateLimiter.ts";
import { buildProviders } from "./gateway/providers.ts";
import { loadApiEnv, type ApiEnv } from "./config/env.ts";
import { Settings } from "./config/settings.ts";
import { startObservability, stopObservability } from "./observability.ts";
import { makeMiddleware } from "./http/middleware.ts";
import { makeRoutes } from "./http/routes.ts";
import { NativeAuthService } from "./nativeAuth/NativeAuthService.ts";
import { abusePolicy } from "./security/abusePolicy.ts";
import { createRedisLockouts } from "./security/throttle.ts";

export interface ApiRuntime {
  readonly env: ApiEnv;
  readonly db: ReturnType<typeof createDatabase>["db"];
  readonly ledger: LedgerService;
  readonly billing: BillingService;
  readonly stripe: StripeGateway;
  readonly trial: TrialService;
  readonly gateway: GatewayService;
  readonly adminAuth: AdminAuth;
  readonly admin: AdminService;
  readonly sync: SyncService;
  readonly blobs: BlobStore;
  readonly runner: ChatRunner;
  readonly outbox: MockOutbox | null;
  readonly address: { readonly host: string; readonly port: number };
  readonly close: () => Promise<void>;
}

function makeNotifier(
  env: ApiEnv,
  senders: { email: EmailSender; sms: SmsSender },
  locale: ReturnType<typeof makeLocaleLookup>,
): AuthNotifier {
  return {
    sendEmailOtp: async ({ email, otp }) => {
      await senders.email.send(emailOtp(email, otp, await locale.byEmail(email)));
    },
    sendPhoneOtp: async ({ phoneNumber, code }) => {
      await senders.sms.sendVerification({
        phoneNumber,
        code,
        locale: await locale.byPhone(phoneNumber),
      });
    },
    sendPasswordReset: async ({ email, url }) => {
      await senders.email.send(passwordReset(email, url, await locale.byEmail(email)));
    },
    sendOrganizationInvitation: async ({ email, organizationName, inviterEmail, invitationId }) => {
      const url = `${env.webPublicUrl}/invite/${invitationId}`;
      await senders.email.send(
        organizationInvite(email, organizationName, inviterEmail, url, await locale.byEmail(email)),
      );
    },
    sendTwoFactorOtp: async ({ email, otp }) => {
      await senders.email.send(emailOtp(email, otp, await locale.byEmail(email)));
    },
  };
}

export async function startApi(
  options: {
    readonly env?: ApiEnv;
    readonly port?: number;
    readonly host?: string;
  } = {},
): Promise<ApiRuntime> {
  const env = options.env ?? loadApiEnv();
  startObservability({
    serviceName: "djl-api",
    version: process.env.DJL_VERSION ?? "dev",
    environment: env.env,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || null,
    otlpHeaders: process.env.OTEL_EXPORTER_OTLP_HEADERS?.trim() || null,
    sentryDsn: process.env.SENTRY_DSN?.trim() || null,
  });
  const { db, close: closeDb } = createDatabase(env.databaseUrl);

  let outbox: MockOutbox | null = null;
  let senders: { email: EmailSender; sms: SmsSender; alerts?: TeamAlertSender };
  if (env.mockExternals) {
    outbox = new MockOutbox(env.env === "local");
    senders = { email: outbox, sms: outbox, alerts: outbox };
  } else {
    senders = {
      email: createResendSender({
        apiKey: requireEnv("RESEND_API_KEY"),
        from: "DJL Cloud <no-reply@slcor.com>",
        replyTo: "support@slcor.com",
      }),
      sms: createTwilioSender({
        accountSid: requireEnv("TWILIO_ACCOUNT_SID"),
        authToken: requireEnv("TWILIO_AUTH_TOKEN"),
        verifyServiceSid: requireEnv("TWILIO_VERIFY_SERVICE_SID"),
        fromNumber: process.env.TWILIO_FROM_NUMBER ?? "",
      }),
    };
  }

  // Auth throttles, the session denylist, and admin lockouts are shared by every instance.
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  const revocations = createSessionRevocations(redis);
  const auth = createAuth({
    env,
    db,
    notifier: makeNotifier(env, senders, makeLocaleLookup(db)),
    redis,
    revocations,
  });
  const region = process.env.FLY_REGION ?? "local";
  const readiness = {
    ready: async () => {
      try {
        await db.execute("select 1");
        return true;
      } catch {
        return false;
      }
    },
  };

  const ledger = new LedgerService(db);
  const verifyAccessToken = makeAccessTokenVerifier({
    issuer: env.apiPublicUrl,
    loadJwks: () => auth.api.getJwks(),
  });
  const principals = makePrincipalResolver(auth, db, { verifyAccessToken, revocations });
  const stripe: StripeGateway = env.mockExternals
    ? new FakeStripeGateway()
    : createStripeGateway({
        secretKey: requireEnv("STRIPE_SECRET_KEY"),
        webhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"),
      });
  const billing = new BillingService(db, ledger, stripe, {
    webPublicUrl: env.webPublicUrl,
    topupPriceId: process.env.STRIPE_TOPUP_PRICE_ID ?? "price_topup_fake",
  });
  const trial = new TrialService(db, ledger, senders.sms, {
    credits: 200,
    expiryDays: 14,
    dailyBudgetUsdCents: 10_000,
    hashSalt: env.ipHashSalt,
  });
  const limiter: RateLimiter = env.mockExternals
    ? createMemoryRateLimiter()
    : createRedisRateLimiter(redis);
  const providers = buildProviders(env, process.env, (alert) => {
    void senders.alerts?.post(alert);
  });
  const usage = new UsageService(db);
  const settings = new Settings(db);
  const gateway = new GatewayService({
    db,
    ledger,
    limiter,
    settings,
    admission: { window: windowPolicy(usage), abuse: abusePolicy({ db, limiter }) },
    providers,
    trial,
    config: {
      region,
      catalogTtlMs: 30_000,
      refusalFlagThreshold: 10,
    },
    onAlert: (alert) => void senders.alerts?.post(alert),
  });
  const version = process.env.DJL_VERSION ?? "dev";
  const blobs: BlobStore = env.mockExternals
    ? new FakeBlobStore()
    : createS3BlobStore({
        endpoint: requireEnv("STORAGE_S3_ENDPOINT"),
        region: process.env.STORAGE_S3_REGION ?? "us-east-1",
        bucket: process.env.STORAGE_BUCKET ?? "djl-sync",
        accessKeyId: requireEnv("STORAGE_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("STORAGE_SECRET_ACCESS_KEY"),
      });
  const sync = new SyncService(db, blobs);
  const runLog = new RunLog(db, redis);
  const runner = new ChatRunner({ db, gateway, log: runLog, blobs });
  const tasks = createPgBossTaskQueue(env.databaseUrl);
  const files = new FileService(db, blobs, settings);
  const chat = new ChatService({ db, files, runner, tasks });
  const shares = new ShareService(db, chat, blobs, env.webPublicUrl);
  const runs = new RunService(db, runLog);
  const adminAuth = new AdminAuth(db, {
    appSecret: env.betterAuthSecret,
    ipSalt: env.ipHashSalt,
    lockouts: createRedisLockouts(redis, { prefix: "admin:lockout", ...ADMIN_LOCKOUT }),
    mfaRequired: env.adminMfaRequired,
  });
  const admin = new AdminService({
    db,
    ledger,
    limiter,
    gateway,
    trial,
    auth: adminAuth,
    email: senders.email,
    adminPublicUrl: env.adminPublicUrl,
    version,
  });
  const usageAdmin = new UsageAdminService({ db, usage, alerts: senders.alerts });
  const routes = makeRoutes({
    env,
    auth,
    readiness,
    version,
    db,
    ledger,
    principals,
    billing,
    trial,
    gateway,
    ipSalt: env.ipHashSalt,
    nativeAuth: new NativeAuthService(db, auth),
    adminAuth,
    admin,
    secureCookies: env.env !== "local" && env.env !== "test",
    gatewayStatus: () => gateway.status(),
    sync,
    usage,
    usageAdmin,
    chat,
    files,
    shares,
    runs,
    limiter,
    pushTokens: new PushTokenService(db),
  });
  const scope = Scope.makeUnsafe();
  let nodeServer: http.Server | null = null;

  const program = Effect.gen(function* () {
    const server = yield* NodeHttpServer.make(
      () => {
        nodeServer = http.createServer();
        return nodeServer;
      },
      { host: options.host ?? "0.0.0.0", port: options.port ?? env.port },
    );
    const app = yield* HttpRouter.toHttpEffect(routes);
    yield* server.serve(makeMiddleware(env, region)(app));
    return server.address;
  });

  const address = await Effect.runPromise(Scope.provide(program, scope));
  const bound =
    address._tag === "TcpAddress"
      ? { host: address.hostname, port: address.port }
      : { host: "unix", port: 0 };

  return {
    env,
    db,
    ledger,
    billing,
    stripe,
    trial,
    gateway,
    adminAuth,
    admin,
    sync,
    blobs,
    runner,
    outbox,
    address: bound,
    close: async () => {
      await Effect.runPromise(Scope.close(scope, { _tag: "Success", value: undefined } as never));
      await runner.stop();
      await tasks.close();
      redis.disconnect();
      await closeDb();
      await stopObservability();
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// Keep Layer imported for route composition typing parity with the monorepo.
void Layer;

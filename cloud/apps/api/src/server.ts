/**
 * Composes env, database, auth, notifiers, and routes into a running HTTP
 * server. `startApi` returns the bound address and a close function so tests
 * can spin up a real server on an ephemeral port.
 */
import http from "node:http";
import { createHash } from "node:crypto";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { createDatabase, schema } from "@djl/db";
import { and, eq } from "drizzle-orm";
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
import { createAuth, PERSONAL_ORG_METADATA, type AuthNotifier } from "./auth/auth.ts";
import { createCommerceAuth, requireCommerceAuthTestEnv } from "./auth/commerceAuth.ts";
import { makePrincipalResolver } from "./auth/guard.ts";
import { makeLocaleLookup } from "./auth/locale.ts";
import { createSessionRevocations } from "./auth/revocations.ts";
import { BillingService } from "./billing/BillingService.ts";
import { CommerceService } from "./commerce/CommerceService.ts";
import { CommerceReconciliationService } from "./commerce/CommerceReconciliationService.ts";
import {
  CommerceAlertDeliveryService,
  commerceAlertEmailConfig,
} from "./commerce/CommerceAlertDeliveryService.ts";
import { CommerceAlertsService, commerceAlertsEnabled } from "./commerce/CommerceAlertsService.ts";
import { CommercePaymentService } from "./commerce/CommercePaymentService.ts";
import {
  createCommerceStripeGateway,
  type CommerceStripeGateway,
} from "./commerce/CommerceStripeGateway.ts";
import { createCommerceImageSearch } from "./commerce/ImageSearchService.ts";
import { CommerceImageUploads } from "./commerce/CommerceImageUploads.ts";
import { CommerceAddressLookup } from "./commerce/CommerceAddressLookup.ts";
import { commerceAddressLookupKey } from "./commerce/addressLookupRoutes.ts";
import { commerceRuntimeConfig } from "./config/commerce.ts";
import {
  FakeStripeGateway,
  createStripeGateway,
  type StripeGateway,
} from "./billing/StripeGateway.ts";
import { grantWeeklyFreeAllowance } from "./credits/freeAllowance.ts";
import { LedgerService } from "./credits/LedgerService.ts";
import { TrialService } from "./trial/TrialService.ts";
import { ADMIN_LOCKOUT, AdminAuth } from "./admin/AdminAuth.ts";
import { AdminService } from "./admin/AdminService.ts";
import { GatewayService } from "./gateway/GatewayService.ts";
import { blobStoreFromEnv, type BlobStore } from "./sync/BlobStore.ts";
import { SyncService } from "./sync/SyncService.ts";
import { UsageAdminService } from "./usage/UsageAdminService.ts";
import { UsageService } from "./usage/UsageService.ts";
import { windowPolicy } from "./usage/windowPolicy.ts";
import { ChatService } from "./chat/ChatService.ts";
import { FileService } from "./files/FileService.ts";
import { ChatRunner } from "./runs/ChatRunner.ts";
import { resumeWindowBlockedRuns } from "./agent/resume.ts";
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
import { ApiError } from "./http/errors.ts";
import { ImageService } from "./images/ImageService.ts";
import { NotificationService } from "./notifications/NotificationService.ts";

export interface ApiRuntime {
  readonly env: ApiEnv;
  readonly db: ReturnType<typeof createDatabase>["db"];
  readonly ledger: LedgerService;
  readonly billing: BillingService;
  readonly commerce: CommerceService;
  readonly commerceAlerts: CommerceAlertsService;
  readonly commerceReconciliation: CommerceReconciliationService;
  readonly commercePayments: CommercePaymentService;
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
  redis: Redis,
): AuthNotifier {
  const verificationKey = (phone: string) =>
    `auth:sms:verification:${createHash("sha256").update(phone).digest("hex")}`;
  return {
    sendEmailOtp: async ({ email, otp }) => {
      await senders.email.send(emailOtp(email, otp, await locale.byEmail(email)));
    },
    sendPhoneOtp: async ({ phoneNumber, code }) => {
      const verification = await senders.sms.sendVerification({
        phoneNumber,
        code,
        locale: await locale.byPhone(phoneNumber),
      });
      await redis.set(verificationKey(phoneNumber), verification.id, "EX", 300);
    },
    confirmPhoneOtp: async (phoneNumber) => {
      const key = verificationKey(phoneNumber);
      const id = await redis.get(key);
      if (!id) return;
      await senders.sms.approveVerification(id);
      // A concurrent resend may already have stored a different verification.
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
        1,
        key,
        id,
      );
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
    readonly testCommerceAuth?: boolean;
  } = {},
): Promise<ApiRuntime> {
  const env = options.env ?? loadApiEnv();
  const commerceConfig = commerceRuntimeConfig(env, process.env);
  if (options.testCommerceAuth) {
    requireCommerceAuthTestEnv(env);
    if (
      options.host !== "127.0.0.1" ||
      commerceConfig.mode !== "test" ||
      commerceConfig.paymentProvider !== "simulation"
    )
      throw new Error("Commerce authentication pilot requires loopback and simulated commerce.");
  }
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
    const smsDisabled = async (): Promise<never> => {
      throw new ApiError(503, "sms_disabled", "SMS is not available.");
    };
    senders = {
      email: createResendSender({
        apiKey: requireEnv("RESEND_API_KEY"),
        from: process.env.EMAIL_FROM ?? "DJL Cloud <no-reply@slcor.com>",
        replyTo: process.env.EMAIL_REPLY_TO ?? "support@slcor.com",
      }),
      sms: env.smsEnabled
        ? createTwilioSender({
            accountSid: requireEnv("TWILIO_ACCOUNT_SID"),
            authToken: requireEnv("TWILIO_AUTH_TOKEN"),
            verifyServiceSid: requireEnv("TWILIO_VERIFY_SERVICE_SID"),
            fromNumber: process.env.TWILIO_FROM_NUMBER ?? "",
          })
        : {
            sendVerification: smsDisabled,
            approveVerification: smsDisabled,
            lookupLineType: smsDisabled,
            sendText: smsDisabled,
          },
    };
  }

  // Auth throttles, the session denylist, and admin lockouts are shared by every instance.
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  const revocations = createSessionRevocations(redis);
  const ledger = new LedgerService(db);
  const notifier = makeNotifier(env, senders, makeLocaleLookup(db), redis);
  const auth = createAuth({
    env,
    db,
    notifier,
    redis,
    revocations,
    onEmailVerified: async (userId) => {
      const [personal] = await db
        .select({ orgId: schema.member.organizationId })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .where(
          and(
            eq(schema.member.userId, userId),
            eq(schema.organization.metadata, PERSONAL_ORG_METADATA),
          ),
        );
      if (personal)
        await grantWeeklyFreeAllowance(db, ledger, {
          userId,
          orgId: personal.orgId,
          actor: "system:signup",
        });
    },
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
  const billing = new BillingService(db, stripe, {
    webPublicUrl: env.webPublicUrl,
    topupPriceId: env.mockExternals
      ? (process.env.STRIPE_TOPUP_PRICE_ID ?? "price_topup_fake")
      : requireEnv("STRIPE_TOPUP_PRICE_ID"),
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
  const tasks = createPgBossTaskQueue(env.databaseUrl, {
    producerOnly: process.env.PG_BOSS_PRODUCER_ONLY === "true",
  });
  const resumeRuns = (userId: string | null) =>
    resumeWindowBlockedRuns({ db, enqueue: tasks.enqueue }, userId);
  const usage = new UsageService(db, undefined, resumeRuns);
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
  const blobs: BlobStore = blobStoreFromEnv(process.env, { mockExternals: env.mockExternals });
  const sync = new SyncService(db, blobs);
  const runLog = new RunLog(db, redis);
  const runner = new ChatRunner({ db, gateway, log: runLog, blobs });
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
    revocations,
    resumeRuns,
    email: senders.email,
    adminPublicUrl: env.adminPublicUrl,
    version,
  });
  const usageAdmin = new UsageAdminService({ db, usage, alerts: senders.alerts, resumeRuns });
  const commerceReconciliation = new CommerceReconciliationService(db, {
    environment: env.env,
    mode: commerceConfig.mode,
  });
  // Status only: the API never creates a commerce email sender or dispatches notifications.
  const commerceAlertEmail = new CommerceAlertDeliveryService(
    db,
    commerceAlertEmailConfig({
      ...process.env,
      DJL_ENV: env.env,
      DJL_MOCK_EXTERNALS: String(env.mockExternals),
    }),
  );
  const commerceAlerts = new CommerceAlertsService(db, {
    enabled: commerceAlertsEnabled(process.env.DJL_COMMERCE_ALERTS_ENABLED, env.env),
    environment: env.env,
    emailDelivery: commerceAlertEmail,
  });
  const commerce = new CommerceService(db, {
    mode: commerceConfig.mode,
    environment: env.env,
    mediaPolicy: {
      webPublicUrl: env.webPublicUrl,
      apiPublicUrl: env.apiPublicUrl,
      ...(process.env.DJL_COMMERCE_MEDIA_ORIGIN
        ? { mediaOrigin: process.env.DJL_COMMERCE_MEDIA_ORIGIN }
        : {}),
    },
    paymentProvider: commerceConfig.paymentProvider,
    checkoutPaused: commerceConfig.checkoutPaused,
    withdrawalsPaused: commerceConfig.withdrawalsPaused,
    supplierPaymentDocumentsEnabled:
      process.env.DJL_COMMERCE_SUPPLIER_PAYMENT_RECORDS_ENABLED === "true",
  });
  const stripeTestEnabled = commerceConfig.stripeEnabled;
  let commerceStripe: CommerceStripeGateway | undefined;
  if (stripeTestEnabled) {
    try {
      commerceStripe = createCommerceStripeGateway({
        secretKey: process.env.DJL_COMMERCE_STRIPE_SECRET_KEY ?? "",
        webhookSecret: process.env.DJL_COMMERCE_STRIPE_WEBHOOK_SECRET ?? "",
      });
    } catch {
      // A broken opt-in shop integration must not take down existing AI services or leak keys.
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "commerce_stripe_disabled",
          code: "configuration_invalid",
        }),
      );
    }
  }
  const commercePayments = new CommercePaymentService(commerce, {
    enabled: stripeTestEnabled,
    environment: env.env,
    webPublicUrl: env.webPublicUrl,
    ...(commerceStripe ? { gateway: commerceStripe } : {}),
  });
  const imageUploads = new CommerceImageUploads(db, blobs, {
    enabled: (): Promise<boolean> => imageSearch.available(),
    limiter,
  });
  const imageSearch = createCommerceImageSearch({
    db,
    commerce,
    uploads: imageUploads,
    providers,
    limiter,
    redis,
    mockExternals: env.mockExternals,
    environment: env.env,
    webPublicUrl: env.webPublicUrl,
    apiPublicUrl: env.apiPublicUrl,
    processEnv: process.env,
  });
  const addressLookupKey = commerceAddressLookupKey(env, process.env);
  const routes = makeRoutes({
    ...(options.testCommerceAuth
      ? { testCommerceAuth: createCommerceAuth({ env, db, redis, notifier }) }
      : {}),
    commerce,
    commerceAlerts,
    commerceReconciliation,
    trustedOrigins: env.trustedOrigins,
    adminMfaRequired: env.adminMfaRequired,
    commercePayments,
    imageSearch,
    imageUploads,
    ...(addressLookupKey ? { addressLookup: new CommerceAddressLookup(addressLookupKey) } : {}),
    notifications: new NotificationService(db),
    images: new ImageService({ db, chat, gateway }),
    clientConfig: {
      auth: { google: Boolean(env.google), apple: Boolean(env.apple) },
      gateway,
      fileParsing:
        process.env.PARSER_CONFIGURED === "fly:available" ||
        (process.env.SANDBOX_BACKEND === "fly" && Boolean(process.env.FLY_API_TOKEN)),
      pushConfigured:
        process.env.APNS_CONFIGURED === "available:available:available" ||
        Boolean(
          process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY,
        ),
      policyUrls: {
        terms: process.env.PUBLIC_TERMS_URL || null,
        privacy: process.env.PUBLIC_PRIVACY_URL || null,
      },
    },
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
    const makeBun =
      typeof Bun === "undefined"
        ? null
        : (yield* Effect.promise(() => import("@effect/platform-bun/BunHttpServer"))).make;
    const server = makeBun
      ? yield* makeBun({
          hostname: options.host ?? "0.0.0.0",
          port: options.port ?? env.port,
          idleTimeout: 0,
          maxRequestBodySize: Number.MAX_SAFE_INTEGER,
          development: false,
        })
      : yield* NodeHttpServer.make(
          () => {
            nodeServer = http.createServer();
            return nodeServer;
          },
          { host: options.host ?? "0.0.0.0", port: options.port ?? env.port },
        );
    const app = yield* HttpRouter.toHttpEffect(routes);
    yield* server.serve(
      makeMiddleware(env, region, options.testCommerceAuth ? env.webPublicUrl : undefined)(app),
    );
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
    commerce,
    commerceAlerts,
    commerceReconciliation,
    commercePayments,
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

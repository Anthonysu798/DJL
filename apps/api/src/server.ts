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
} from "@djl/notify";
import { Effect, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { createAuth, type AuthNotifier } from "./auth/auth.ts";
import { makePrincipalResolver } from "./auth/guard.ts";
import { BillingService } from "./billing/BillingService.ts";
import {
  FakeStripeGateway,
  createStripeGateway,
  type StripeGateway,
} from "./billing/StripeGateway.ts";
import { LedgerService } from "./credits/LedgerService.ts";
import { loadApiEnv, type ApiEnv } from "./config/env.ts";
import { makeMiddleware } from "./http/middleware.ts";
import { makeRoutes } from "./http/routes.ts";

export interface ApiRuntime {
  readonly env: ApiEnv;
  readonly db: ReturnType<typeof createDatabase>["db"];
  readonly ledger: LedgerService;
  readonly billing: BillingService;
  readonly stripe: StripeGateway;
  readonly outbox: MockOutbox | null;
  readonly address: { readonly host: string; readonly port: number };
  readonly close: () => Promise<void>;
}

function makeNotifier(env: ApiEnv, senders: { email: EmailSender; sms: SmsSender }): AuthNotifier {
  const locale = "en" as const; // per-user locale lands with the dashboard; templates are ready
  return {
    sendEmailOtp: async ({ email, otp }) => {
      await senders.email.send(emailOtp(email, otp, locale));
    },
    sendPhoneOtp: async ({ phoneNumber, code }) => {
      await senders.sms.sendVerification({ phoneNumber, code, locale });
    },
    sendPasswordReset: async ({ email, url }) => {
      await senders.email.send(passwordReset(email, url, locale));
    },
    sendOrganizationInvitation: async ({ email, organizationName, inviterEmail, invitationId }) => {
      const url = `${env.webPublicUrl}/invite/${invitationId}`;
      await senders.email.send(
        organizationInvite(email, organizationName, inviterEmail, url, locale),
      );
    },
    sendTwoFactorOtp: async ({ email, otp }) => {
      await senders.email.send(emailOtp(email, otp, locale));
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
  const { db, close: closeDb } = createDatabase(env.databaseUrl);

  let outbox: MockOutbox | null = null;
  let senders: { email: EmailSender; sms: SmsSender };
  if (env.mockExternals) {
    outbox = new MockOutbox(env.env === "local");
    senders = { email: outbox, sms: outbox };
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

  const auth = createAuth({ env, db, notifier: makeNotifier(env, senders) });
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
  const principals = makePrincipalResolver(auth, db);
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
  const routes = makeRoutes({
    env,
    auth,
    readiness,
    version: process.env.DJL_VERSION ?? "dev",
    db,
    ledger,
    principals,
    billing,
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
    outbox,
    address: bound,
    close: async () => {
      await Effect.runPromise(Scope.close(scope, { _tag: "Success", value: undefined } as never));
      await closeDb();
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

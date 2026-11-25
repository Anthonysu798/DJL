/**
 * Better Auth configuration: the single source of truth for accounts,
 * sessions, organizations, phone OTP, two-factor, passkeys, and JWT access
 * tokens. Every decision here traces to docs/specs/2026-09-12-phase-0-cloud-control-plane.md.
 *
 * Session model: the Better Auth session token is the 30-day rotating refresh
 * credential; GET /v1/auth/token exchanges it for a 15-minute access token
 * (audience "djl-cloud", `sid` claim) that guard.ts verifies locally against
 * the JWKS. Deleting a session puts its id on the Redis denylist so its access
 * tokens stop working at once. Throttles live in Redis so every instance
 * shares them.
 */
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  admin,
  bearer,
  deviceAuthorization,
  emailOTP,
  haveIBeenPwned,
  jwt,
  organization,
  phoneNumber,
  twoFactor,
} from "better-auth/plugins";

import type { DjlDatabase } from "@djl/db";
import { schema } from "@djl/db";
import { and, eq, ne } from "drizzle-orm";
import type { Redis } from "ioredis";

import type { ApiEnv } from "../config/env.ts";
import { createRedisThrottle } from "../security/throttle.ts";
import { ACCESS_TOKEN_AUDIENCE } from "./accessTokens.ts";
import { revokeCommerceAuth } from "./commerceAuthGeneration.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { normalizePhoneNumber } from "./phone.ts";
import type { SessionRevocations } from "./revocations.ts";

const DAY = 60 * 60 * 24;

/** Routes that mail a code to an address, and routes that check one. */
const OTP_SEND_PATHS = new Set([
  "/sign-up/email",
  "/email-otp/send-verification-otp",
  "/email-otp/request-password-reset",
]);
const OTP_CHECK_PATHS = new Set([
  "/email-otp/verify-email",
  "/sign-in/email-otp",
  "/email-otp/reset-password",
]);
/** Per email address, whatever IP asks: a six-digit code must not be guessable by volume. */
const OTP_EMAIL_LIMIT = { window: 60 * 60, max: 10 };
/** Code sign-ins that must clear two-factor exactly as a password sign-in does. */
const OTP_SIGN_IN_PATHS = new Set([
  "/sign-in/email-otp",
  "/email-otp/verify-email",
  "/phone-number/verify",
]);

/** Client ids allowed to start the device flow. */
export const DEVICE_CLIENT_IDS = new Set(["djl-desktop", "djl-ios", "djl-cli"]);

export interface AuthNotifier {
  readonly sendEmailOtp: (input: {
    readonly email: string;
    readonly otp: string;
    readonly type: "sign-in" | "email-verification" | "forget-password" | "change-email";
  }) => Promise<void>;
  readonly sendPhoneOtp: (input: {
    readonly phoneNumber: string;
    readonly code: string;
  }) => Promise<void>;
  readonly confirmPhoneOtp: (phoneNumber: string) => Promise<void>;
  readonly sendPasswordReset: (input: {
    readonly email: string;
    readonly url: string;
  }) => Promise<void>;
  readonly sendOrganizationInvitation: (input: {
    readonly email: string;
    readonly organizationName: string;
    readonly inviterEmail: string;
    readonly invitationId: string;
  }) => Promise<void>;
  readonly sendTwoFactorOtp: (input: {
    readonly email: string;
    readonly otp: string;
  }) => Promise<void>;
}

export function createAuth(input: {
  readonly env: ApiEnv;
  readonly db: DjlDatabase;
  readonly notifier: AuthNotifier;
  readonly redis: Redis;
  readonly revocations: SessionRevocations;
  /** Runs once a user has a verified email: at sign-up (social) or on verification. */
  readonly onEmailVerified?: (userId: string) => Promise<void>;
}) {
  const { env, db, notifier, redis, revocations, onEmailVerified } = input;
  const nativeAdmin = admin();
  const otpThrottle = createRedisThrottle(redis, "auth:otp");
  const twoFactorPlugin = twoFactor({
    issuer: "DJL Cloud",
    otpOptions: {
      sendOTP: async ({ user, otp }) => {
        await notifier.sendTwoFactorOtp({ email: user.email, otp });
      },
    },
  });
  return betterAuth({
    appName: "DJL Cloud",
    baseURL: env.apiPublicUrl,
    basePath: "/v1/auth",
    secret: env.betterAuthSecret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    trustedOrigins: [...env.trustedOrigins],
    // Email-code routes no DJL client calls.
    disabledPaths: [
      "/email-otp/check-verification-otp",
      "/forget-password/email-otp",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      password: { hash: hashPassword, verify: verifyPassword },
      sendResetPassword: async ({ user, url }) => {
        await notifier.sendPasswordReset({ email: user.email, url });
      },
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: false, // email OTP plugin handles verification codes
      autoSignInAfterVerification: true,
      // Whoever proves the mailbox inherits no session or linked sign-in that an
      // earlier, unproven registration left on the account.
      beforeEmailVerification: async (user) => {
        if (user.emailVerified) return;
        const ended = await db
          .delete(schema.session)
          .where(eq(schema.session.userId, user.id))
          .returning({ id: schema.session.id });
        await revocations.revoke(ended.map((session) => session.id));
        await db
          .delete(schema.account)
          .where(
            and(eq(schema.account.userId, user.id), ne(schema.account.providerId, "credential")),
          );
      },
    },
    // Native apps post the provider's ID token to /sign-in/social ({ provider, idToken }).
    // Google accepts tokens minted for any listed client id (web first, then iOS); Apple
    // accepts the web service id and the iOS bundle id, with the nonce checked by Better Auth.
    socialProviders: {
      ...(env.google
        ? {
            google: {
              clientId: [env.google.clientId, ...env.google.extraClientIds],
              clientSecret: env.google.clientSecret,
            },
          }
        : {}),
      ...(env.apple
        ? {
            apple: {
              clientId: env.apple.clientId,
              clientSecret: env.apple.clientSecret,
              appBundleIdentifier: env.apple.appBundleIdentifier,
              audience: [env.apple.clientId, env.apple.appBundleIdentifier],
            },
          }
        : {}),
    },
    account: {
      accountLinking: {
        enabled: true,
        // Only providers that assert verified emails may auto-link (decision: Linking).
        trustedProviders: ["google", "apple"],
      },
    },
    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
      freshAge: 15 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customStorage: createRedisThrottle(redis, "auth:rl"),
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/phone-number/send-otp": { window: 60, max: 3 },
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/forget-password": { window: 60, max: 3 },
      },
    },
    user: {
      additionalFields: {
        // Email and SMS language; set at sign-up or through update-user.
        locale: { type: "string", required: false, input: true },
      },
      changeEmail: { enabled: true },
      deleteUser: { enabled: false }, // deletion goes through the DJL soft-delete flow
    },
    advanced: {
      useSecureCookies: env.env !== "local" && env.env !== "test",
      cookiePrefix: "djl",
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["fly-client-ip", "cf-connecting-ip", "x-forwarded-for"] },
      // app.slcor.com and api.slcor.com share the session cookie (decision: Hostnames).
      ...(env.cookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: env.cookieDomain } }
        : {}),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body: unknown = ctx.body;
        if (typeof body !== "object" || body === null) return;
        if ("email" in body && typeof body.email === "string") {
          const kind = OTP_SEND_PATHS.has(ctx.path)
            ? "send"
            : OTP_CHECK_PATHS.has(ctx.path)
              ? "check"
              : null;
          if (
            kind &&
            !(await otpThrottle.consume(`${kind}:${body.email.toLowerCase()}`, OTP_EMAIL_LIMIT))
              .allowed
          )
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many codes for this email. Try again later.",
            });
        }
        if ("phoneNumber" in body && typeof body.phoneNumber === "string") {
          // A phone number reaches an account only by verifying it, in one spelling.
          const phoneNumber =
            ctx.path === "/sign-in/phone-number" || ctx.path.startsWith("/phone-number/")
              ? normalizePhoneNumber(body.phoneNumber)
              : null;
          if (!phoneNumber) throw new APIError("BAD_REQUEST", { message: "Invalid phone number" });
          return { context: { body: { ...body, phoneNumber } } };
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Ordinary sign-out and individual revocations remain realm-local.
        const result: unknown = ctx.context.returned;
        if (typeof result !== "object" || result === null) return;
        if (ctx.path === "/sign-up/email") {
          // Better Auth answers a sign-up for a registered email with a made-up user
          // and drops the password. If that registration was never verified, this
          // sign-up replaces its password: the code now in the mailbox must not
          // verify an account that still opens with an earlier stranger's password.
          if (!("user" in result) || typeof result.user !== "object" || result.user === null)
            return;
          const { email, password, name } = ctx.body as Record<
            "email" | "password" | "name",
            string
          >;
          const existing = await db.query.user.findFirst({
            where: eq(schema.user.email, email.toLowerCase()),
          });
          if (
            !existing ||
            ("id" in result.user && result.user.id === existing.id) ||
            existing.emailVerified ||
            existing.banned ||
            existing.phoneNumber
          )
            return;
          const hash = await ctx.context.password.hash(password);
          await db.transaction(async (tx) => {
            await tx
              .delete(schema.account)
              .where(
                and(
                  eq(schema.account.userId, existing.id),
                  eq(schema.account.providerId, "credential"),
                ),
              );
            await tx.insert(schema.account).values({
              userId: existing.id,
              providerId: "credential",
              accountId: existing.id,
              password: hash,
              updatedAt: new Date(),
            });
            await tx.update(schema.user).set({ name }).where(eq(schema.user.id, existing.id));
          });
        } else if (ctx.path === "/revoke-sessions" || ctx.path === "/revoke-other-sessions") {
          const userId = ctx.context.session?.user.id;
          if (userId && "status" in result && result.status === true)
            await revokeCommerceAuth(db, userId);
        } else if (
          ctx.path === "/admin/revoke-user-sessions" &&
          "success" in result &&
          result.success === true
        ) {
          // Only the successful native permission-checked handler reaches here.
          // Apply its exact schema so the scoped target equals the Cloud target.
          const { userId } = nativeAdmin.endpoints.revokeUserSessions.options.body.parse(ctx.body);
          await revokeCommerceAuth(db, userId);
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Every user owns a hidden personal organization that holds credits
          // and billing (decision: Personal org). Created in the same flow as
          // the user so no account ever exists without a billing owner.
          after: async (user) => {
            await createPersonalOrganization(db, user.id, user.name || user.email);
            if (user.emailVerified) await onEmailVerified?.(user.id);
          },
        },
        update: {
          after: async (user) => {
            if (user.emailVerified) await onEmailVerified?.(user.id);
          },
        },
      },
      session: {
        delete: {
          // Runs for sign-out, revoke, password reset, and user-session sweeps alike.
          after: async (session) => {
            await revocations.revoke([session.id]);
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: 10,
        creatorRole: "owner",
        membershipLimit: 100,
        invitationExpiresIn: 7 * DAY,
        sendInvitationEmail: async (data) => {
          await notifier.sendOrganizationInvitation({
            email: data.email,
            organizationName: data.organization.name,
            inviterEmail: data.inviter.user.email,
            invitationId: data.id,
          });
        },
        // Only createPersonalOrganization marks an organization as personal.
        organizationHooks: {
          beforeCreateOrganization: refusePersonalMarker,
          beforeUpdateOrganization: refusePersonalMarker,
          // A personal organization has exactly one member, its owner. Letting anyone else
          // in would share the owner's credits, files and synced history.
          beforeCreateInvitation: refusePersonalTarget,
          beforeAcceptInvitation: refusePersonalTarget,
          beforeAddMember: refusePersonalTarget,
        },
      }),
      ...(env.smsEnabled
        ? [
            phoneNumber({
              otpLength: 6,
              expiresIn: 300,
              allowedAttempts: 5,
              sendOTP: async ({ phoneNumber, code }) => {
                await notifier.sendPhoneOtp({ phoneNumber, code });
              },
              callbackOnVerification: async ({ phoneNumber }) => {
                await notifier.confirmPhoneOtp(phoneNumber);
              },
              signUpOnVerification: {
                // Phone-only accounts get a placeholder email (decision: Identifiers).
                getTempEmail: (phone) => `${phone.replace(/[^0-9]/g, "")}@phone.djl.invalid`,
                getTempName: (phone) => phone,
              },
            }),
          ]
        : []),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: "hashed",
        sendVerificationOnSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          await notifier.sendEmailOtp({ email, otp, type });
        },
      }),
      // The plugin challenges password sign-ins only; an emailed or texted code would
      // otherwise sign a two-factor account straight in.
      {
        ...twoFactorPlugin,
        hooks: {
          after: twoFactorPlugin.hooks.after.map((hook) => ({
            handler: hook.handler,
            matcher: (ctx: Parameters<typeof hook.matcher>[0]) =>
              hook.matcher(ctx) || OTP_SIGN_IN_PATHS.has(ctx.path ?? ""),
          })),
        },
      },
      // The ceremony runs on the web app while the API serves it, so the relying
      // party is the registrable parent domain both hosts share.
      passkey({
        rpID: env.passkeyRpId,
        rpName: "DJL Cloud",
        origin: [env.webPublicUrl],
      }),
      jwt({
        jwt: {
          issuer: env.apiPublicUrl,
          audience: ACCESS_TOKEN_AUDIENCE,
          expirationTime: "15m",
          // Only ids: the guard reloads the user so bans and deletions apply immediately.
          definePayload: ({ session }) => ({ sid: session.id }),
        },
      }),
      bearer(),
      haveIBeenPwned(),
      nativeAdmin,
      // OAuth device flow for desktop and iOS: the app shows a short code, the
      // user approves it in the browser after signing in by any method, and the
      // app polls for its session. No deep links, works on every platform.
      deviceAuthorization({
        expiresIn: "10m",
        interval: "5s",
        userCodeLength: 8,
        verificationUri: `${env.webPublicUrl}/device`,
        validateClient: async (clientId) => DEVICE_CLIENT_IDS.has(clientId),
      }),
    ],
  });
}

export type DjlAuth = ReturnType<typeof createAuth>;

export const PERSONAL_ORG_METADATA = JSON.stringify({ kind: "personal" });

async function refusePersonalMarker(input: {
  readonly organization: { readonly metadata?: Record<string, unknown> };
}) {
  if (input.organization.metadata?.["kind"] === "personal")
    throw new APIError("BAD_REQUEST", { message: "This organization kind is reserved." });
}

/** Whether an organization, as Better Auth hands it to a hook, is someone's personal org. */
export function isPersonalOrganization(organization: { readonly metadata?: unknown }): boolean {
  const metadata = organization.metadata;
  if (typeof metadata === "string") return metadata === PERSONAL_ORG_METADATA;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>)["kind"] === "personal"
  );
}

async function refusePersonalTarget(input: {
  readonly organization: { readonly metadata?: unknown };
}) {
  if (isPersonalOrganization(input.organization))
    throw new APIError("FORBIDDEN", { message: "Personal accounts cannot have other members." });
}

export async function createPersonalOrganization(
  db: DjlDatabase,
  userId: string,
  displayName: string,
) {
  const slug = `u-${userId.replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();
  await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(schema.organization)
      .values({
        name: `${displayName}`.slice(0, 80),
        slug,
        createdAt: now,
        metadata: PERSONAL_ORG_METADATA,
      })
      .onConflictDoNothing({ target: schema.organization.slug })
      .returning();
    if (!org) return; // already exists (idempotent on retried hooks)
    await tx
      .insert(schema.member)
      .values({ organizationId: org.id, userId, role: "owner", createdAt: now });
    await tx.insert(schema.creditBalances).values({ orgId: org.id }).onConflictDoNothing();
  });
}

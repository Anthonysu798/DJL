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
import type { Redis } from "ioredis";

import type { ApiEnv } from "../config/env.ts";
import { createRedisThrottle } from "../security/throttle.ts";
import { ACCESS_TOKEN_AUDIENCE } from "./accessTokens.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import type { SessionRevocations } from "./revocations.ts";

const DAY = 60 * 60 * 24;

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
  return betterAuth({
    appName: "DJL Cloud",
    baseURL: env.apiPublicUrl,
    basePath: "/v1/auth",
    secret: env.betterAuthSecret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    trustedOrigins: [...env.trustedOrigins],
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
      }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        sendOTP: async ({ phoneNumber, code }) => {
          await notifier.sendPhoneOtp({ phoneNumber, code });
        },
        signUpOnVerification: {
          // Phone-only accounts get a placeholder email (decision: Identifiers).
          getTempEmail: (phone) => `${phone.replace(/[^0-9]/g, "")}@phone.djl.invalid`,
          getTempName: (phone) => phone,
        },
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        sendVerificationOnSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          await notifier.sendEmailOtp({ email, otp, type });
        },
      }),
      twoFactor({
        issuer: "DJL Cloud",
        otpOptions: {
          sendOTP: async ({ user, otp }) => {
            await notifier.sendTwoFactorOtp({ email: user.email, otp });
          },
        },
      }),
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
      admin(),
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

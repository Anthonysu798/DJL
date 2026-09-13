/**
 * Better Auth configuration: the single source of truth for accounts,
 * sessions, organizations, phone OTP, two-factor, passkeys, and JWT access
 * tokens. Every decision here traces to docs/specs/2026-09-12-phase-0-cloud-control-plane.md.
 *
 * Session model: the Better Auth session token is the 30-day rotating refresh
 * credential; the JWT plugin mints 15-minute access tokens verified via JWKS
 * by the gateway and cloud runners.
 */
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  admin,
  bearer,
  emailOTP,
  haveIBeenPwned,
  jwt,
  organization,
  phoneNumber,
  twoFactor,
} from "better-auth/plugins";

import type { DjlDatabase } from "@djl/db";
import { schema } from "@djl/db";

import type { ApiEnv } from "../config/env.ts";
import { hashPassword, verifyPassword } from "./password.ts";

const DAY = 60 * 60 * 24;

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
}) {
  const { env, db, notifier } = input;
  const apiUrl = new URL(env.apiPublicUrl);
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
    socialProviders: {
      ...(env.google
        ? { google: { clientId: env.google.clientId, clientSecret: env.google.clientSecret } }
        : {}),
      ...(env.apple
        ? { apple: { clientId: env.apple.clientId, clientSecret: env.apple.clientSecret } }
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
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/phone-number/send-otp": { window: 60, max: 3 },
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/forget-password": { window: 60, max: 3 },
      },
    },
    user: {
      changeEmail: { enabled: true },
      deleteUser: { enabled: false }, // deletion goes through the DJL soft-delete flow
    },
    advanced: {
      useSecureCookies: env.env !== "local" && env.env !== "test",
      cookiePrefix: "djl",
      database: { generateId: "uuid" },
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
      passkey({
        rpID: apiUrl.hostname,
        rpName: "DJL Cloud",
        origin: env.webPublicUrl,
      }),
      jwt({
        jwt: {
          issuer: env.apiPublicUrl,
          audience: "djl-cloud",
          expirationTime: "15m",
        },
      }),
      bearer(),
      haveIBeenPwned(),
      admin(),
    ],
  });
}

export type DjlAuth = ReturnType<typeof createAuth>;

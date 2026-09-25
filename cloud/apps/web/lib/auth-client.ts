"use client";
import { createAuthClient } from "better-auth/react";
import {
  deviceAuthorizationClient,
  emailOTPClient,
  organizationClient,
  phoneNumberClient,
  twoFactorClient,
} from "better-auth/client/plugins";

import { AUTH_URL } from "./config";

export const authClient = createAuthClient({
  baseURL: AUTH_URL,
  plugins: [
    organizationClient(),
    emailOTPClient(),
    phoneNumberClient(),
    twoFactorClient(),
    deviceAuthorizationClient(),
  ],
});

export type Session = typeof authClient.$Infer.Session;

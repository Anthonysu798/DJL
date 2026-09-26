/**
 * DJL Cloud account operations for the local server: status (with credits),
 * sign-in, and sign-out. Talks to the control plane with the stored session
 * and persists the session in the secrets directory.
 *
 * Sign-in is browser-first: an authorization code with PKCE S256 comes back
 * through the `djl://auth/callback` deep link and is redeemed here. The PKCE
 * verifier and the `state` never leave this process, and a callback is only
 * accepted for a state issued here in the last ten minutes, once. The OAuth
 * device flow (a short code typed in the browser) remains as the fallback.
 */
import { createHash, randomBytes } from "node:crypto";

import {
  DJL_DESKTOP_CLIENT_ID,
  DJL_NATIVE_AUTH_REDIRECT_URI,
  type CloudAccountStatus,
  type CloudBrowserSignInCompleteInput,
  type CloudBrowserSignInStartResult,
  type CloudNativeTokenResponse,
  type CloudOrgId,
  type CloudSignInPollResult,
  type CloudSignInStartResult,
  type CloudUserId,
} from "@synara/contracts";

import {
  CloudApiError,
  createCloudClient,
  probeCloudRegion,
  resolveCloudBaseUrl,
  resolveCloudWebUrl,
  type CloudClient,
  type CloudRegionSetting,
  type FetchLike,
} from "./api";
import {
  clearCloudSession,
  readCloudSession,
  writeCloudSession,
  type CloudSession,
} from "./session";

/** How long a started browser sign-in may take before its state is forgotten. */
const BROWSER_SIGN_IN_TTL_MS = 10 * 60_000;

export interface CloudAccountDeps {
  readonly secretsDir: string;
  readonly region: () => Promise<CloudRegionSetting>;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => number;
}

interface PendingBrowserSignIn {
  readonly verifier: string;
  readonly apiBaseUrl: string;
  readonly expiresAt: number;
}

interface MeResponse {
  user: { id: string; email: string };
  activeOrgId: string;
}

export class CloudAccount {
  private readonly pendingBrowserSignIns = new Map<string, PendingBrowserSignIn>();

  constructor(private readonly deps: CloudAccountDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async client(baseUrl?: string): Promise<CloudClient> {
    if (baseUrl) return createCloudClient(baseUrl, this.deps.fetchImpl);
    const region = await this.deps.region();
    if (region === "auto" && !process.env.DJL_CLOUD_API_URL)
      await probeCloudRegion(this.deps.fetchImpl);
    return createCloudClient(resolveCloudBaseUrl(region), this.deps.fetchImpl);
  }

  async session(): Promise<CloudSession | null> {
    return readCloudSession(this.deps.secretsDir);
  }

  async status(): Promise<CloudAccountStatus> {
    const checkedAt = new Date().toISOString();
    const session = await this.session();
    if (!session) {
      const client = await this.client();
      return { signedIn: false, apiBaseUrl: client.baseUrl, checkedAt };
    }
    const client = await this.client(session.apiBaseUrl);
    const base = {
      signedIn: true as const,
      apiBaseUrl: session.apiBaseUrl,
      email: session.email,
      userId: session.userId as CloudUserId,
      orgId: session.orgId as CloudOrgId,
      checkedAt,
    };
    try {
      const credits = await client.get<CloudAccountStatus["credits"]>("/v1/credits", session.token);
      return { ...base, ...(credits ? { credits } : {}) };
    } catch (error) {
      if (error instanceof CloudApiError) {
        if (error.detail.status === 401) return { ...base, problem: "session_expired" };
        if (error.detail.code === "suspended") return { ...base, problem: "suspended" };
      }
      return { ...base, problem: "unreachable" };
    }
  }

  async startSignIn(): Promise<CloudSignInStartResult & { readonly apiBaseUrl: string }> {
    const client = await this.client();
    const result = await client.post<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
      expires_in: number;
      interval: number;
    }>("/v1/auth/device/code", { client_id: DJL_DESKTOP_CLIENT_ID, scope: "desktop" });
    return {
      apiBaseUrl: client.baseUrl,
      deviceCode: result.device_code,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      ...(result.verification_uri_complete
        ? { verificationUriComplete: result.verification_uri_complete }
        : {}),
      expiresInSeconds: result.expires_in,
      intervalSeconds: result.interval,
    };
  }

  async pollSignIn(deviceCode: string, apiBaseUrl?: string): Promise<CloudSignInPollResult> {
    const client = await this.client(apiBaseUrl);
    try {
      const token = await client.post<{ access_token?: string; token_type?: string }>(
        "/v1/auth/device/token",
        {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: DJL_DESKTOP_CLIENT_ID,
        },
      );
      if (!token.access_token) return { state: "pending" };
      await this.storeSession(client, token.access_token);
      return { state: "complete", status: await this.status() };
    } catch (error) {
      if (error instanceof CloudApiError) {
        // RFC 8628 error codes are returned in the body's error.code by Better Auth.
        const code = error.detail.code;
        if (code === "authorization_pending") return { state: "pending" };
        if (code === "slow_down") return { state: "slow_down", intervalSeconds: 10 };
        if (code === "access_denied") return { state: "denied" };
        if (code === "expired_token") return { state: "expired" };
      }
      throw error;
    }
  }

  async startBrowserSignIn(): Promise<CloudBrowserSignInStartResult> {
    const client = await this.client();
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(24).toString("base64url");
    const now = this.now();
    for (const [key, pending] of this.pendingBrowserSignIns)
      if (pending.expiresAt <= now) this.pendingBrowserSignIns.delete(key);
    this.pendingBrowserSignIns.set(state, {
      verifier,
      apiBaseUrl: client.baseUrl,
      expiresAt: now + BROWSER_SIGN_IN_TTL_MS,
    });
    const url = new URL(`${resolveCloudWebUrl()}/authorize`);
    url.searchParams.set("client_id", DJL_DESKTOP_CLIENT_ID);
    url.searchParams.set("redirect_uri", DJL_NATIVE_AUTH_REDIRECT_URI);
    url.searchParams.set("state", state);
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizeUrl: url.toString(), expiresInSeconds: BROWSER_SIGN_IN_TTL_MS / 1000 };
  }

  async completeBrowserSignIn(input: CloudBrowserSignInCompleteInput): Promise<CloudAccountStatus> {
    const pending = this.pendingBrowserSignIns.get(input.state);
    // Single use, whatever happens next: a replayed or forged callback never reaches the API.
    this.pendingBrowserSignIns.delete(input.state);
    if (!pending || pending.expiresAt <= this.now())
      throw new Error("This sign-in did not start in this app, or it expired. Start again.");
    const client = await this.client(pending.apiBaseUrl);
    const session = await client.post<CloudNativeTokenResponse>("/v1/native-auth/token", {
      clientId: DJL_DESKTOP_CLIENT_ID,
      code: input.code,
      codeVerifier: pending.verifier,
      redirectUri: DJL_NATIVE_AUTH_REDIRECT_URI,
    });
    await this.storeSession(client, session.sessionToken);
    return this.status();
  }

  private async storeSession(client: CloudClient, token: string): Promise<void> {
    const me = await client.get<MeResponse>("/v1/me", token);
    await writeCloudSession(this.deps.secretsDir, {
      apiBaseUrl: client.baseUrl,
      token,
      userId: me.user.id,
      email: me.user.email,
      orgId: me.activeOrgId,
      createdAt: new Date().toISOString(),
    });
  }

  async signOut(): Promise<CloudAccountStatus> {
    const session = await this.session();
    if (session) {
      const client = await this.client(session.apiBaseUrl);
      await client.post("/v1/auth/sign-out", {}, session.token).catch(() => undefined);
      await clearCloudSession(this.deps.secretsDir);
    }
    return this.status();
  }
}

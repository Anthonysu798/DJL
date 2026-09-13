/**
 * DJL Cloud account operations for the local server: status (with credits),
 * the OAuth device flow for sign-in, and sign-out. Talks to the control plane
 * with the stored session and persists the session in the secrets directory.
 */
import type {
  CloudAccountStatus,
  CloudOrgId,
  CloudSignInPollResult,
  CloudSignInStartResult,
  CloudUserId,
} from "@synara/contracts";

import { CloudApiError, createCloudClient, probeCloudRegion, resolveCloudBaseUrl, type CloudClient, type CloudRegionSetting,
  type FetchLike,
} from "./api";
import { clearCloudSession, readCloudSession, writeCloudSession, type CloudSession } from "./session";

export const DJL_CLOUD_DEVICE_CLIENT_ID = "djl-desktop";

export interface CloudAccountDeps {
  readonly secretsDir: string;
  readonly region: () => Promise<CloudRegionSetting>;
  readonly fetchImpl?: FetchLike;
}

interface MeResponse {
  user: { id: string; email: string };
  activeOrgId: string;
}

export class CloudAccount {
  constructor(private readonly deps: CloudAccountDeps) {}

  private async client(baseUrl?: string): Promise<CloudClient> {
    if (baseUrl) return createCloudClient(baseUrl, this.deps.fetchImpl);
    const region = await this.deps.region();
    if (region === "auto" && !process.env.DJL_CLOUD_API_URL) await probeCloudRegion(this.deps.fetchImpl);
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
    }>("/v1/auth/device/code", { client_id: DJL_CLOUD_DEVICE_CLIENT_ID, scope: "desktop" });
    return {
      apiBaseUrl: client.baseUrl,
      deviceCode: result.device_code,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      ...(result.verification_uri_complete ? { verificationUriComplete: result.verification_uri_complete } : {}),
      expiresInSeconds: result.expires_in,
      intervalSeconds: result.interval,
    };
  }

  async pollSignIn(deviceCode: string, apiBaseUrl?: string): Promise<CloudSignInPollResult> {
    const client = await this.client(apiBaseUrl);
    try {
      const token = await client.post<{ access_token?: string; token_type?: string }>("/v1/auth/device/token", {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: DJL_CLOUD_DEVICE_CLIENT_ID,
      });
      if (!token.access_token) return { state: "pending" };
      const me = await client.get<MeResponse>("/v1/me", token.access_token);
      await writeCloudSession(this.deps.secretsDir, {
        apiBaseUrl: client.baseUrl,
        token: token.access_token,
        userId: me.user.id,
        email: me.user.email,
        orgId: me.activeOrgId,
        createdAt: new Date().toISOString(),
      });
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

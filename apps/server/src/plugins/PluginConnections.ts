// FILE: PluginConnections.ts
// Purpose: Each plugin app's sign-in: starting it, finishing it from the browser redirect,
//          keeping the access token fresh, and knowing when the user has to reconnect.

import { randomBytes } from "node:crypto";

import type { PluginAppConnection } from "@synara/contracts";

import {
  OAuthGrantRejected,
  buildAuthorizeUrl,
  createPkce,
  discoverEndpoints,
  exchangeCode,
  pollDeviceToken,
  refreshTokens,
  registerClient,
  requestDeviceCode,
  type DevicePoll,
  type Fetch,
  type OAuthClient,
  type OAuthTokens,
} from "./pluginOAuth";

/** Where credentials are kept. Values never leave this process except to the tool server. */
export interface PluginSecrets {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

interface StoredCredential {
  readonly resource: string;
  readonly tokenEndpoint: string;
  readonly client: OAuthClient;
  readonly tokens: OAuthTokens;
  readonly connectedAt: string;
  /** Set once the server has refused the grant; only a new sign-in clears it. */
  readonly expired?: boolean;
}

interface PendingSignIn {
  readonly pluginId: string;
  readonly appId: string;
  readonly resource: string;
  readonly tokenEndpoint: string;
  readonly client: OAuthClient;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly deadline: number;
}

const SIGN_IN_TTL_MS = 10 * 60_000;
const REFRESH_BEFORE_EXPIRY_MS = 60_000;

const appKey = (pluginId: string, appId: string) => `${pluginId}\n${appId}`;
const secretName = (pluginId: string, appId: string) => `plugin.${pluginId}.${appId}.credential`;
const accessTokenName = (pluginId: string, appId: string) => `plugin.${pluginId}.${appId}.token`;

type Sleep = (ms: number) => Promise<void>;

// Unref'd so a sign-in the user walked away from never keeps the server process alive.
const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

export class PluginConnections {
  readonly #secrets: PluginSecrets;
  readonly #fetch: Fetch;
  readonly #sleep: Sleep;
  readonly #pending = new Map<string, PendingSignIn>();
  /** Device sign-ins being waited on, by app; the value tells a newer attempt from an old one. */
  readonly #devicePending = new Map<string, symbol>();
  readonly #errors = new Map<string, string>();
  readonly #refreshing = new Map<string, Promise<string>>();

  constructor(secrets: PluginSecrets, fetchFn: Fetch = fetch, sleep: Sleep = defaultSleep) {
    this.#secrets = secrets;
    this.#fetch = fetchFn;
    this.#sleep = sleep;
  }

  async describe(pluginId: string, appId: string): Promise<PluginAppConnection> {
    const key = appKey(pluginId, appId);
    const now = Date.now();
    if (this.#devicePending.has(key)) return { pluginId, appId, state: "connecting" };
    for (const [state, pending] of this.#pending) {
      if (pending.deadline < now) this.#pending.delete(state);
      else if (appKey(pending.pluginId, pending.appId) === key) {
        return { pluginId, appId, state: "connecting" };
      }
    }
    const error = this.#errors.get(key);
    if (error) return { pluginId, appId, state: "error", message: error };
    const credential = await this.#read(pluginId, appId);
    if (!credential) return { pluginId, appId, state: "not_connected" };
    return {
      pluginId,
      appId,
      state: credential.expired ? "expired" : "connected",
      connectedAt: credential.connectedAt,
    };
  }

  /** Returns the address to open in the user's browser. */
  async begin(input: {
    pluginId: string;
    appId: string;
    serverUrl: string;
    redirectUri: string;
  }): Promise<string> {
    const key = appKey(input.pluginId, input.appId);
    this.#cancelPending(key);
    try {
      const endpoints = await discoverEndpoints(this.#fetch, input.serverUrl);
      const client = await registerClient(this.#fetch, endpoints, input.redirectUri);
      const { verifier, challenge } = createPkce();
      const state = randomBytes(24).toString("base64url");
      this.#pending.set(state, {
        pluginId: input.pluginId,
        appId: input.appId,
        resource: input.serverUrl,
        tokenEndpoint: endpoints.tokenEndpoint,
        client,
        verifier,
        redirectUri: input.redirectUri,
        deadline: Date.now() + SIGN_IN_TTL_MS,
      });
      return buildAuthorizeUrl({
        endpoints,
        client,
        redirectUri: input.redirectUri,
        state,
        challenge,
        resource: input.serverUrl,
      });
    } catch (cause) {
      this.#errors.set(key, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  /**
   * Starts a device sign-in with DJL's own client id, for servers that do not let DJL register
   * itself. Returns the page to open and the code the user confirms there; DJL then waits for
   * the approval on its own, so nothing comes back to DJL through the browser.
   */
  async beginDevice(input: {
    pluginId: string;
    appId: string;
    serverUrl: string;
    clientId: string;
    scopes: ReadonlyArray<string>;
  }): Promise<{ verificationUri: string; userCode: string }> {
    const key = appKey(input.pluginId, input.appId);
    this.#cancelPending(key);
    try {
      const endpoints = await discoverEndpoints(this.#fetch, input.serverUrl);
      if (!endpoints.deviceAuthorizationEndpoint) {
        throw new Error("This plugin's sign-in server does not offer device sign-in.");
      }
      const device = await requestDeviceCode(this.#fetch, {
        endpoint: endpoints.deviceAuthorizationEndpoint,
        clientId: input.clientId,
        scope: input.scopes.join(" "),
      });
      const attempt = Symbol(key);
      this.#devicePending.set(key, attempt);
      void this.#waitForDevice({
        ...input,
        key,
        attempt,
        tokenEndpoint: endpoints.tokenEndpoint,
        deviceCode: device.deviceCode,
        intervalMs: device.intervalMs,
        expiresAt: device.expiresAt,
      });
      return { verificationUri: device.verificationUri, userCode: device.userCode };
    } catch (cause) {
      this.#errors.set(key, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  async #waitForDevice(input: {
    pluginId: string;
    appId: string;
    serverUrl: string;
    clientId: string;
    key: string;
    attempt: symbol;
    tokenEndpoint: string;
    deviceCode: string;
    intervalMs: number;
    expiresAt: number;
  }): Promise<void> {
    const current = () => this.#devicePending.get(input.key) === input.attempt;
    let intervalMs = input.intervalMs;
    let failures = 0;
    try {
      while (current()) {
        await this.#sleep(intervalMs);
        if (!current()) return;
        if (Date.now() > input.expiresAt) {
          throw new Error("The sign-in code ran out. Start again.");
        }
        let poll: DevicePoll;
        try {
          poll = await pollDeviceToken(this.#fetch, {
            tokenEndpoint: input.tokenEndpoint,
            clientId: input.clientId,
            deviceCode: input.deviceCode,
          });
          failures = 0;
        } catch (cause) {
          // A dropped connection is retried; a declined or expired code is not.
          if (cause instanceof OAuthGrantRejected || (failures += 1) >= 5) throw cause;
          continue;
        }
        if (poll.status === "slow_down") intervalMs += 5_000;
        if (poll.status !== "approved") continue;
        if (!current()) return;
        await this.#write(input.pluginId, input.appId, {
          resource: input.serverUrl,
          tokenEndpoint: input.tokenEndpoint,
          client: { clientId: input.clientId },
          tokens: poll.tokens,
          connectedAt: new Date().toISOString(),
        });
        return;
      }
    } catch (cause) {
      if (current())
        this.#errors.set(input.key, cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current()) this.#devicePending.delete(input.key);
    }
  }

  /** Drops any sign-in already under way for this app, and its last error. */
  #cancelPending(key: string): void {
    this.#errors.delete(key);
    this.#devicePending.delete(key);
    for (const [state, pending] of this.#pending) {
      if (appKey(pending.pluginId, pending.appId) === key) this.#pending.delete(state);
    }
  }

  /** Finishes a sign-in from the browser redirect. The state value works exactly once. */
  async complete(params: URLSearchParams): Promise<{ pluginId: string; appId: string }> {
    const state = params.get("state") ?? "";
    const pending = this.#pending.get(state);
    this.#pending.delete(state);
    if (!pending || pending.deadline < Date.now()) {
      throw new Error("This sign-in link has expired. Start again from Plugins in DJL.");
    }
    const key = appKey(pending.pluginId, pending.appId);
    try {
      const denied = params.get("error");
      if (denied) throw new Error(params.get("error_description") ?? `Sign-in failed (${denied}).`);
      const code = params.get("code");
      if (!code) throw new Error("The sign-in server did not return a code.");
      const tokens = await exchangeCode(this.#fetch, {
        tokenEndpoint: pending.tokenEndpoint,
        client: pending.client,
        code,
        verifier: pending.verifier,
        redirectUri: pending.redirectUri,
        resource: pending.resource,
      });
      await this.#write(pending.pluginId, pending.appId, {
        resource: pending.resource,
        tokenEndpoint: pending.tokenEndpoint,
        client: pending.client,
        tokens,
        connectedAt: new Date().toISOString(),
      });
      return { pluginId: pending.pluginId, appId: pending.appId };
    } catch (cause) {
      this.#errors.set(key, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  async disconnect(pluginId: string, appId: string): Promise<void> {
    this.#cancelPending(appKey(pluginId, appId));
    await this.#secrets.remove(secretName(pluginId, appId));
    await this.#secrets.remove(accessTokenName(pluginId, appId));
  }

  /** An access token the user typed in for a server that takes one instead of a sign-in. */
  setStaticToken(pluginId: string, appId: string, token: string): Promise<void> {
    return this.#secrets.set(accessTokenName(pluginId, appId), token);
  }

  staticToken(pluginId: string, appId: string): Promise<string | null> {
    return this.#secrets.get(accessTokenName(pluginId, appId));
  }

  /** A token that is good to send now. Throws when the user has to reconnect. */
  async accessToken(pluginId: string, appId: string): Promise<string> {
    const credential = await this.#read(pluginId, appId);
    if (!credential || credential.expired) throw new Error("This plugin needs to be reconnected.");
    const { expiresAt } = credential.tokens;
    if (expiresAt === undefined || expiresAt - Date.now() > REFRESH_BEFORE_EXPIRY_MS) {
      return credential.tokens.accessToken;
    }
    return this.#refresh(pluginId, appId, credential);
  }

  /** Called after the tool server refused the current token. True when a new one is ready. */
  async refreshAfterUnauthorized(pluginId: string, appId: string): Promise<boolean> {
    const credential = await this.#read(pluginId, appId);
    if (!credential || credential.expired) return false;
    try {
      await this.#refresh(pluginId, appId, credential);
      return true;
    } catch {
      // #refresh has already marked the connection expired if the grant itself was refused.
      return false;
    }
  }

  /** The tool server refused even a freshly issued token: only a new sign-in can help. */
  async markExpired(pluginId: string, appId: string): Promise<void> {
    const credential = await this.#read(pluginId, appId);
    if (credential && !credential.expired) {
      await this.#write(pluginId, appId, { ...credential, expired: true });
    }
  }

  /** Parallel calls share one refresh, since many servers rotate the refresh token on use. */
  #refresh(pluginId: string, appId: string, credential: StoredCredential): Promise<string> {
    const key = appKey(pluginId, appId);
    const running = this.#refreshing.get(key);
    if (running) return running;
    const refresh = (async () => {
      const { refreshToken } = credential.tokens;
      if (!refreshToken) {
        await this.markExpired(pluginId, appId);
        throw new Error("This plugin needs to be reconnected.");
      }
      try {
        const tokens = await refreshTokens(this.#fetch, {
          tokenEndpoint: credential.tokenEndpoint,
          client: credential.client,
          refreshToken,
          resource: credential.resource,
        });
        await this.#write(pluginId, appId, {
          ...credential,
          tokens: { refreshToken, ...tokens },
        });
        return tokens.accessToken;
      } catch (cause) {
        if (cause instanceof OAuthGrantRejected) await this.markExpired(pluginId, appId);
        throw cause;
      }
    })().finally(() => this.#refreshing.delete(key));
    this.#refreshing.set(key, refresh);
    return refresh;
  }

  async #read(pluginId: string, appId: string): Promise<StoredCredential | null> {
    const raw = await this.#secrets.get(secretName(pluginId, appId));
    return raw ? (JSON.parse(raw) as StoredCredential) : null;
  }

  #write(pluginId: string, appId: string, credential: StoredCredential): Promise<void> {
    return this.#secrets.set(secretName(pluginId, appId), JSON.stringify(credential));
  }
}

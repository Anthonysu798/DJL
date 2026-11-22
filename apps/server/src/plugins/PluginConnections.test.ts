import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginSource } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { DJL_PLUGIN_SOURCE } from "./catalog";
import { PluginConnections, type PluginSecrets } from "./PluginConnections";
import { PluginGateway } from "./PluginGateway";
import { discoverEndpoints } from "./pluginOAuth";
import { PluginStore } from "./PluginStore";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/**
 * One local server playing both parts a real vendor plays: the sign-in server (metadata,
 * registration, token endpoint) and the tool server that only accepts the current access token.
 */
async function vendor(options: { expiresIn?: number } = {}) {
  const log = {
    registrations: [] as Array<Record<string, unknown>>,
    tokenRequests: [] as Array<Record<string, string>>,
    toolCalls: [] as string[],
  };
  const control = { rejectRefresh: false, issued: 0, validAccess: "" };
  let origin = "";
  const json = (response: http.ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    request.on("end", () => {
      const url = request.url ?? "";
      if (url === "/.well-known/oauth-protected-resource/mcp") {
        return json(response, 200, { authorization_servers: [origin] });
      }
      if (url === "/.well-known/oauth-authorization-server") {
        return json(response, 200, {
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url === "/register") {
        log.registrations.push(JSON.parse(raw) as Record<string, unknown>);
        return json(response, 201, { client_id: `client-${log.registrations.length}` });
      }
      if (url === "/token") {
        const params = Object.fromEntries(new URLSearchParams(raw));
        log.tokenRequests.push(params);
        if (params.grant_type === "refresh_token" && control.rejectRefresh) {
          return json(response, 400, { error: "invalid_grant" });
        }
        control.issued += 1;
        control.validAccess = `access-${control.issued}`;
        return json(response, 200, {
          access_token: control.validAccess,
          refresh_token: `refresh-${control.issued}`,
          token_type: "Bearer",
          expires_in: options.expiresIn ?? 3600,
        });
      }
      if (url === "/mcp") {
        const token = request.headers.authorization ?? "";
        log.toolCalls.push(token);
        if (token !== `Bearer ${control.validAccess}`) {
          response.writeHead(401, { "WWW-Authenticate": "Bearer" });
          return response.end();
        }
        return json(response, 200, { jsonrpc: "2.0", id: 1, result: { tools: [] } });
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, log, control };
}

async function setup(options: { expiresIn?: number } = {}) {
  const fake = await vendor(options);
  const stateDir = await mkdtemp(join(tmpdir(), "djl-plugin-connections-"));
  cleanups.push(() => rm(stateDir, { recursive: true, force: true }));
  const values = new Map<string, string>();
  const secrets: PluginSecrets = {
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => void values.set(name, value),
    remove: async (name) => void values.delete(name),
  };
  const connections = new PluginConnections(secrets);
  const sources: PluginSource[] = [
    {
      id: "test",
      kind: "djl",
      name: "Test",
      plugins: [
        {
          ...DJL_PLUGIN_SOURCE.plugins.find((plugin) => plugin.id === "linear")!,
          id: "acme",
          name: "acme",
          displayName: "Acme <b>",
          apps: [
            {
              id: "acme",
              name: "Acme",
              transport: { type: "http", url: `${fake.origin}/mcp` },
              auth: "oauth",
            },
          ],
        },
      ],
    },
  ];
  const store = new PluginStore(stateDir, connections, sources);
  const gateway = new PluginGateway(
    () => store.gatewayApps(),
    async (params) => {
      try {
        await connections.complete(params);
        return { ok: true, title: "Acme <b> is connected", detail: "Close this tab." };
      } catch (cause) {
        return { ok: false, title: "Sign-in did not finish", detail: (cause as Error).message };
      }
    },
  );
  cleanups.push(() => gateway.close());
  await store.install("acme");

  const state = async () => (await store.snapshot()).connections[0]!;
  /** Starts a sign-in and returns what the sign-in server would send back to the browser. */
  const begin = async () => {
    const redirectUri = await gateway.oauthRedirectUri();
    const authorize = new URL((await store.connect("acme", "acme", redirectUri)).authorizeUrl);
    return { authorize, redirectUri, callbackState: authorize.searchParams.get("state")! };
  };
  const callback = (redirectUri: string, query: Record<string, string>) =>
    fetch(`${redirectUri}?${new URLSearchParams(query)}`);
  const signIn = async () => {
    const started = await begin();
    await callback(started.redirectUri, { code: "the-code", state: started.callbackState });
    return started;
  };
  const callTool = async () => {
    const session = (await gateway.registerSession())!;
    return fetch(session.servers[0]!.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.bearerToken}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  };
  return { fake, store, gateway, values, state, begin, callback, signIn, callTool };
}

describe("plugin sign-in", () => {
  it("registers DJL, sends the user to sign in, and connects when they come back", async () => {
    const { fake, state, begin, callback, values } = await setup();
    expect(await state()).toMatchObject({ state: "not_connected" });

    const { authorize, redirectUri, callbackState } = await begin();
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    expect(fake.log.registrations).toEqual([
      expect.objectContaining({
        client_name: "DJL",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    ]);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${fake.origin}/authorize`);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      resource: `${fake.origin}/mcp`,
    });
    expect(await state()).toMatchObject({ state: "connecting" });

    const page = await callback(redirectUri, { code: "the-code", state: callbackState });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Acme &#60;b&#62; is connected");
    expect(html).not.toContain("<b>");

    const exchange = fake.log.tokenRequests[0]!;
    expect(exchange).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      client_id: "client-1",
      redirect_uri: redirectUri,
      resource: `${fake.origin}/mcp`,
    });
    expect(createHash("sha256").update(exchange.code_verifier!).digest("base64url")).toBe(
      authorize.searchParams.get("code_challenge"),
    );
    expect(await state()).toMatchObject({ state: "connected", connectedAt: expect.any(String) });
    expect([...values.keys()]).toEqual(["plugin.acme.acme.credential"]);
  });

  it("accepts a sign-in link once only, and never an unknown one", async () => {
    const { begin, callback } = await setup();
    const { redirectUri, callbackState } = await begin();
    expect((await callback(redirectUri, { code: "c", state: callbackState })).status).toBe(200);
    const replay = await callback(redirectUri, { code: "c", state: callbackState });
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("expired");
    expect((await callback(redirectUri, { code: "c", state: "made-up" })).status).toBe(400);
  });

  it("shows the vendor's refusal as an error without running its text as a page", async () => {
    const { begin, callback, state } = await setup();
    const { redirectUri, callbackState } = await begin();
    const page = await callback(redirectUri, {
      error: "access_denied",
      error_description: "<script>alert(1)</script> denied",
      state: callbackState,
    });
    expect(page.status).toBe(400);
    expect(await page.text()).not.toContain("<script>");
    expect(await state()).toMatchObject({
      state: "error",
      message: expect.stringContaining("denied"),
    });
  });

  it("gives agents the plugin only once connected, using the vendor's token upstream", async () => {
    const { fake, gateway, signIn, callTool } = await setup();
    expect(await gateway.registerSession()).toBeUndefined();
    await signIn();
    expect((await callTool()).status).toBe(200);
    expect(fake.log.toolCalls).toEqual(["Bearer access-1"]);
  });

  it("refreshes a token that is about to run out before using it", async () => {
    const { fake, signIn, callTool, values } = await setup({ expiresIn: 30 });
    await signIn();
    const [first, second] = await Promise.all([callTool(), callTool()]);
    expect([first.status, second.status]).toEqual([200, 200]);
    // Both calls waited for one refresh, and the rotated refresh token was kept.
    expect(fake.log.tokenRequests.map((request) => request.grant_type)).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(fake.log.toolCalls).toEqual(["Bearer access-2", "Bearer access-2"]);
    expect(values.get("plugin.acme.acme.credential")).toContain("refresh-2");
  });

  it("refreshes and retries when the tool server refuses a token it thought was good", async () => {
    const { fake, signIn, callTool } = await setup();
    await signIn();
    fake.control.validAccess = "revoked-elsewhere";
    expect((await callTool()).status).toBe(200);
    expect(fake.log.toolCalls).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("asks for a reconnect when the sign-in can no longer be renewed, then recovers", async () => {
    const { fake, gateway, signIn, callTool, state } = await setup({ expiresIn: 30 });
    await signIn();
    fake.control.rejectRefresh = true;

    const refused = await callTool();
    expect(refused.status).toBe(502);
    expect(refused.headers.get("www-authenticate")).toBeNull();
    expect(await state()).toMatchObject({ state: "expired" });
    expect(await gateway.registerSession()).toBeUndefined();

    fake.control.rejectRefresh = false;
    await signIn();
    expect(await state()).toMatchObject({ state: "connected" });
    expect(await gateway.registerSession()).toBeDefined();
  });

  it("forgets the credentials on disconnect and on uninstall", async () => {
    const { store, signIn, state, values } = await setup();
    await signIn();
    expect(values.size).toBe(1);
    await store.disconnect("acme", "acme");
    expect(values.size).toBe(0);
    expect(await state()).toMatchObject({ state: "not_connected" });

    await signIn();
    expect(values.size).toBe(1);
    await store.uninstall("acme");
    expect(values.size).toBe(0);
  });

  it("refuses to start sign-in for a plugin that is not added", async () => {
    const { store, gateway } = await setup();
    await store.uninstall("acme");
    await expect(store.connect("acme", "acme", await gateway.oauthRedirectUri())).rejects.toThrow(
      "Plugin is not added: acme",
    );
  });
});

describe("sign-in server discovery", () => {
  const stub = (metadata: Record<string, unknown>) =>
    (async (url: string | URL | Request) =>
      String(url).includes("oauth-authorization-server")
        ? Response.json(metadata)
        : new Response(null, { status: 404 })) as typeof fetch;

  it("rejects a sign-in server that would take the user's code over plain http", async () => {
    await expect(
      discoverEndpoints(
        stub({
          authorization_endpoint: "https://vendor.example/authorize",
          token_endpoint: "http://vendor.example/token",
        }),
        "https://vendor.example/mcp",
      ),
    ).rejects.toThrow("not a secure address");
  });

  it("rejects a sign-in server without PKCE", async () => {
    await expect(
      discoverEndpoints(
        stub({
          authorization_endpoint: "https://vendor.example/authorize",
          token_endpoint: "https://vendor.example/token",
          code_challenge_methods_supported: ["plain"],
        }),
        "https://vendor.example/mcp",
      ),
    ).rejects.toThrow("PKCE");
  });
});

describe("device sign-in (GitHub)", () => {
  /** A sign-in server shaped like GitHub's: no registration, device sign-in, tokens that keep. */
  async function deviceVendor(answers: ReadonlyArray<Record<string, unknown>>) {
    const log = { deviceRequests: [] as Array<Record<string, string>>, polls: 0 };
    let origin = "";
    const json = (response: http.ServerResponse, status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const server = http.createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      request.on("end", () => {
        const url = request.url ?? "";
        if (url === "/.well-known/oauth-protected-resource/mcp") {
          return json(response, 200, { authorization_servers: [`${origin}/login/oauth`] });
        }
        if (url === "/.well-known/oauth-authorization-server/login/oauth") {
          return json(response, 200, {
            authorization_endpoint: `${origin}/login/oauth/authorize`,
            token_endpoint: `${origin}/login/oauth/access_token`,
            device_authorization_endpoint: `${origin}/login/device/code`,
            code_challenge_methods_supported: ["S256"],
          });
        }
        if (url === "/login/device/code") {
          log.deviceRequests.push(Object.fromEntries(new URLSearchParams(raw)));
          return json(response, 200, {
            device_code: "device-1",
            user_code: "ABCD-1234",
            verification_uri: `${origin}/login/device`,
            expires_in: 900,
            interval: 5,
          });
        }
        if (url === "/login/oauth/access_token") {
          const params = Object.fromEntries(new URLSearchParams(raw));
          if (params.device_code !== "device-1" || params.client_id !== "djl-client") {
            return json(response, 200, { error: "incorrect_device_code" });
          }
          const answer = answers[Math.min(log.polls, answers.length - 1)]!;
          log.polls += 1;
          return json(response, 200, answer);
        }
        response.writeHead(404);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise((resolve) => server.close(() => resolve())));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { origin, log };
  }

  async function signInWith(answers: ReadonlyArray<Record<string, unknown>>) {
    const fake = await deviceVendor(answers);
    const values = new Map<string, string>();
    const waits: number[] = [];
    const connections = new PluginConnections(
      {
        get: async (name) => values.get(name) ?? null,
        set: async (name, value) => void values.set(name, value),
        remove: async (name) => void values.delete(name),
      },
      fetch,
      async (ms) => void waits.push(ms),
    );
    const started = await connections.beginDevice({
      pluginId: "github",
      appId: "github",
      serverUrl: `${fake.origin}/mcp`,
      clientId: "djl-client",
      scopes: ["repo", "read:org"],
    });
    const settled = async () => {
      for (let i = 0; i < 200; i += 1) {
        const state = await connections.describe("github", "github");
        if (state.state !== "connecting") return state;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("sign-in never settled");
    };
    return { fake, connections, started, settled, waits, values };
  }

  it("shows the code, waits for approval on its own, then connects", async () => {
    const { fake, connections, started, settled, waits, values } = await signInWith([
      { error: "authorization_pending" },
      { error: "slow_down" },
      { access_token: "gho_token", token_type: "bearer", scope: "repo,read:org" },
    ]);
    expect(started).toEqual({
      verificationUri: `${fake.origin}/login/device`,
      userCode: "ABCD-1234",
    });
    expect(fake.log.deviceRequests).toEqual([{ client_id: "djl-client", scope: "repo read:org" }]);

    expect(await settled()).toMatchObject({ state: "connected" });
    expect(await connections.accessToken("github", "github")).toBe("gho_token");
    // GitHub's interval, then 5 s more after it asked DJL to slow down.
    expect(waits).toEqual([5000, 5000, 10000]);
    // Only the credential is kept; no client secret exists to keep.
    expect([...values.keys()]).toEqual(["plugin.github.github.credential"]);
    expect(values.get("plugin.github.github.credential")).not.toContain("secret");
  });

  it("reports a declined sign-in and lets the user start again", async () => {
    const { connections, settled } = await signInWith([{ error: "access_denied" }]);
    expect(await settled()).toMatchObject({ state: "error", message: "Sign-in was cancelled." });
    await expect(connections.accessToken("github", "github")).rejects.toThrow("reconnected");
  });

  it("asks for a new sign-in once GitHub refuses the token, instead of failing quietly", async () => {
    const { connections, settled } = await signInWith([{ access_token: "gho_token" }]);
    await settled();
    // GitHub's tokens carry no refresh token, so a revoked one can only be replaced by signing in.
    expect(await connections.refreshAfterUnauthorized("github", "github")).toBe(false);
    expect(await connections.describe("github", "github")).toMatchObject({ state: "expired" });
  });

  it("stops waiting when the user disconnects mid-way", async () => {
    const { connections, fake } = await signInWith([{ error: "authorization_pending" }]);
    await connections.disconnect("github", "github");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const polls = fake.log.polls;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.log.polls).toBe(polls);
    expect(await connections.describe("github", "github")).toMatchObject({
      state: "not_connected",
    });
  });
});

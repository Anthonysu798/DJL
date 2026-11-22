// FILE: PluginGateway.ts
// Purpose: One loopback endpoint through which agent harnesses reach plugin tool servers.
//          A harness is handed http://127.0.0.1:<port>/mcp/<appKey> plus a per-chat bearer; the
//          gateway forwards the MCP traffic upstream and adds the real credentials there, so
//          the harness never holds a plugin's token.

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { Readable } from "node:stream";

import { pluginServerName } from "@synara/contracts";

export interface GatewayApp {
  /** URL-safe key, unique across plugins. */
  readonly key: string;
  /** The plugin this app belongs to. */
  readonly pluginId: string;
  readonly url: string;
  /** Credentials for the upstream server, read on every request so refreshes apply at once. */
  readonly headers?: () => Promise<Readonly<Record<string, string>>>;
  /** Tries to get new credentials after the server refused the current ones. */
  readonly refresh?: () => Promise<boolean>;
  /** Records that the server refused fresh credentials too, so the user must sign in again. */
  readonly expire?: () => Promise<void>;
}

/** What the browser tab shows after the sign-in server sends the user back to DJL. */
export interface OAuthCallbackResult {
  readonly ok: boolean;
  readonly title: string;
  readonly detail: string;
}

export interface PluginGatewayServer {
  readonly name: string;
  readonly url: string;
  /** The plugin this server belongs to, so a chat can offer only a mentioned plugin's tools. */
  readonly pluginId?: string;
}

export interface PluginGatewaySession {
  readonly bearerToken: string;
  readonly servers: ReadonlyArray<PluginGatewayServer>;
}

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
// What an MCP client and server need from each other; nothing else crosses the gateway.
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "mcp-session-id"];

const tokenKey = (token: string) => createHash("sha256").update(token).digest("hex");

const isLoopbackAddress = (address: string | undefined) =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

/** The name a harness sees the server under; prefixed so it cannot shadow a user's own server. */
export const gatewayServerName = pluginServerName;

async function readBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const RECONNECT_MESSAGE =
  "DJL could not sign in to this plugin. Open Plugins in DJL and reconnect it.";

function reply(response: http.ServerResponse, status: number, message: string) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }));
}

export class PluginGateway {
  readonly #resolveApps: () => Promise<ReadonlyArray<GatewayApp>>;
  readonly #onOAuthCallback:
    | ((params: URLSearchParams) => Promise<OAuthCallbackResult>)
    | undefined;
  readonly #sessions = new Set<string>();
  #server: http.Server | null = null;
  #origin: Promise<string> | null = null;

  constructor(
    resolveApps: () => Promise<ReadonlyArray<GatewayApp>>,
    onOAuthCallback?: (params: URLSearchParams) => Promise<OAuthCallbackResult>,
  ) {
    this.#resolveApps = resolveApps;
    this.#onOAuthCallback = onOAuthCallback;
  }

  /** The address a sign-in server sends the browser back to. Starts the listener if needed. */
  async oauthRedirectUri(): Promise<string> {
    return `${await this.#listen()}/oauth/callback`;
  }

  /** Returns nothing to register when no plugin app is usable, so no port is opened for it. */
  async registerSession(): Promise<PluginGatewaySession | undefined> {
    const apps = await this.#resolveApps();
    if (apps.length === 0) return undefined;
    const origin = await this.#listen();
    const bearerToken = randomBytes(32).toString("base64url");
    this.#sessions.add(tokenKey(bearerToken));
    return {
      bearerToken,
      servers: apps.map((app) => ({
        name: gatewayServerName(app.key),
        url: `${origin}/mcp/${encodeURIComponent(app.key)}`,
        pluginId: app.pluginId,
      })),
    };
  }

  unregisterSession(bearerToken: string): void {
    this.#sessions.delete(tokenKey(bearerToken));
  }

  async close(): Promise<void> {
    this.#sessions.clear();
    const server = this.#server;
    this.#server = null;
    this.#origin = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  #listen(): Promise<string> {
    this.#origin ??= new Promise<string>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.#handle(request, response).catch((cause: unknown) => {
          if (response.headersSent) response.destroy();
          else reply(response, 502, cause instanceof Error ? cause.message : String(cause));
        });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        const bound = server.address();
        if (!bound || typeof bound === "string") {
          reject(new Error("Plugin gateway has no TCP address."));
          return;
        }
        this.#server = server;
        resolve(`http://127.0.0.1:${bound.port}`);
      });
    });
    return this.#origin;
  }

  async #handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const origin = await this.#origin;
    const port = origin ? new URL(origin).port : "";
    if (
      !isLoopbackAddress(request.socket.remoteAddress) ||
      (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`)
    ) {
      reply(response, 403, "Forbidden");
      return;
    }
    const requestUrl = new URL(request.url ?? "/", origin ?? "http://127.0.0.1");
    if (requestUrl.pathname === "/oauth/callback" && request.method === "GET") {
      // No bearer here: the browser arrives from the sign-in server. The single-use state
      // value inside the query is what ties it to a sign-in this app started.
      const result = (await this.#onOAuthCallback?.(requestUrl.searchParams)) ?? {
        ok: false,
        title: "Sign-in is not available",
        detail: "Start again from Plugins in DJL.",
      };
      response.writeHead(result.ok ? 200 : 400, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "Referrer-Policy": "no-referrer",
      });
      response.end(
        `<!doctype html><meta charset="utf-8"><title>DJL</title><body style="font:16px system-ui;margin:20vh auto;max-width:28rem;padding:0 1.5rem;text-align:center;color:#111;background:#fafafa"><h1 style="font-size:1.4rem">${escapeHtml(result.title)}</h1><p style="color:#555">${escapeHtml(result.detail)}</p></body>`,
      );
      return;
    }
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token || !this.#sessions.has(tokenKey(token))) {
      reply(response, 401, "Unauthorized");
      return;
    }
    const match = /^\/mcp\/([^/?]+)$/.exec(request.url ?? "");
    // Looked up per request: a plugin that was disabled or disconnected stops answering at once.
    const app = match
      ? (await this.#resolveApps()).find((item) => item.key === decodeURIComponent(match[1]!))
      : undefined;
    if (!app) {
      reply(response, 404, "This plugin is not available. Check it in Plugins.");
      return;
    }
    const method = request.method ?? "GET";
    if (!["POST", "GET", "DELETE"].includes(method)) {
      reply(response, 405, "Method Not Allowed");
      return;
    }

    const body = method === "POST" ? new Uint8Array(await readBody(request)) : undefined;
    const abort = new AbortController();
    response.once("close", () => abort.abort());
    const send = async () => {
      const headers = new Headers(await app.headers?.());
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = request.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      return fetch(app.url, {
        method,
        headers,
        ...(body ? { body } : {}),
        // A tool server has no reason to send a chat's credentials to another address.
        redirect: "error",
        signal: abort.signal,
      });
    };
    let upstream: Response;
    try {
      upstream = await send();
      if (upstream.status === 401 && (await app.refresh?.())) {
        await upstream.body?.cancel();
        upstream = await send();
        if (upstream.status === 401) await app.expire?.();
      }
    } catch (cause) {
      if (abort.signal.aborted) return;
      throw cause;
    }
    if (upstream.status === 401) {
      // Never pass the upstream challenge through: the harness would start its own sign-in.
      await upstream.body?.cancel();
      reply(response, 502, RECONNECT_MESSAGE);
      return;
    }
    const responseHeaders: Record<string, string> = { "Cache-Control": "no-store" };
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    if (!upstream.body) {
      response.end();
      return;
    }
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream)
      // The upstream dropping mid-stream (or our own abort) must end this response, not the process.
      .on("error", () => response.destroy())
      .pipe(response);
  }
}

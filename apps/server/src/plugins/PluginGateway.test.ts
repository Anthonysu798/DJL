import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { PluginGateway, type GatewayApp } from "./PluginGateway";

interface Seen {
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** A stand-in tool server: answers JSON, or an event stream, or 401 when told to. */
async function upstream(mode: "json" | "sse" | "unauthorized" = "json") {
  const seen: Seen[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      seen.push({ method: request.method ?? "", headers: request.headers, body });
      if (mode === "unauthorized") {
        response.writeHead(401, { "WWW-Authenticate": 'Bearer resource_metadata="https://x"' });
        response.end();
      } else if (mode === "sse") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write('data: {"n":1}\n\n');
        setTimeout(() => response.end('data: {"n":2}\n\n'), 20);
      } else {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "upstream-session",
          "Set-Cookie": "leak=1",
        });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "t" }] } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return { seen, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp` };
}

function gateway(apps: () => ReadonlyArray<GatewayApp>) {
  const instance = new PluginGateway(async () => apps());
  closers.push(() => instance.close());
  return instance;
}

const listTools = (url: string, bearer: string | undefined, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      cookie: "harness=1",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

describe("PluginGateway", () => {
  it("opens nothing when no plugin app is usable", async () => {
    expect(await gateway(() => []).registerSession()).toBeUndefined();
  });

  it("forwards a call upstream with the plugin's credentials, never the chat's", async () => {
    const tools = await upstream();
    const session = (await gateway(() => [
      {
        key: "linear",
        pluginId: "linear",
        url: tools.url,
        headers: async () => ({ authorization: "Bearer real" }),
      },
    ]).registerSession())!;
    expect(session.servers).toEqual([
      {
        name: "djl_linear",
        url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/linear$/),
        pluginId: "linear",
      },
    ]);

    const response = await listTools(session.servers[0]!.url, session.bearerToken, {
      "mcp-protocol-version": "2025-06-18",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "t" }] },
    });
    expect(response.headers.get("mcp-session-id")).toBe("upstream-session");
    expect(response.headers.get("set-cookie")).toBeNull();

    expect(tools.seen).toHaveLength(1);
    const forwarded = tools.seen[0]!;
    expect(forwarded.headers.authorization).toBe("Bearer real");
    expect(forwarded.headers["mcp-protocol-version"]).toBe("2025-06-18");
    expect(forwarded.headers.cookie).toBeUndefined();
    expect(JSON.parse(forwarded.body)).toMatchObject({ method: "tools/list" });
    expect(JSON.stringify(forwarded.headers)).not.toContain(session.bearerToken);
  });

  it("refuses callers without this chat's bearer, and after the chat closes", async () => {
    const tools = await upstream();
    const instance = gateway(() => [{ key: "linear", pluginId: "linear", url: tools.url }]);
    const session = (await instance.registerSession())!;
    const url = session.servers[0]!.url;

    expect((await listTools(url, undefined)).status).toBe(401);
    expect((await listTools(url, "wrong")).status).toBe(401);
    expect((await listTools(url, session.bearerToken)).status).toBe(200);
    instance.unregisterSession(session.bearerToken);
    expect((await listTools(url, session.bearerToken)).status).toBe(401);
    expect(tools.seen).toHaveLength(1);
  });

  it("refuses a request that reached it under another host name", async () => {
    const tools = await upstream();
    const session = (await gateway(() => [
      { key: "linear", pluginId: "linear", url: tools.url },
    ]).registerSession())!;
    const target = new URL(session.servers[0]!.url);
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: target.port,
          path: target.pathname,
          method: "POST",
          headers: { host: "evil.example", authorization: `Bearer ${session.bearerToken}` },
        },
        (response) => resolve(response.statusCode ?? 0),
      );
      request.on("error", reject);
      request.end("{}");
    });
    expect(status).toBe(403);
    expect(tools.seen).toHaveLength(0);
  });

  it("stops serving an app the moment it is no longer usable", async () => {
    const tools = await upstream();
    let apps: GatewayApp[] = [{ key: "linear", pluginId: "linear", url: tools.url }];
    const session = (await gateway(() => apps).registerSession())!;
    const url = session.servers[0]!.url;
    expect((await listTools(url, session.bearerToken)).status).toBe(200);
    apps = [];
    expect((await listTools(url, session.bearerToken)).status).toBe(404);
    expect((await listTools(url.replace("linear", "other"), session.bearerToken)).status).toBe(404);
  });

  it("turns an upstream sign-in challenge into a reconnect message", async () => {
    const tools = await upstream("unauthorized");
    const session = (await gateway(() => [
      { key: "linear", pluginId: "linear", url: tools.url },
    ]).registerSession())!;
    const response = await listTools(session.servers[0]!.url, session.bearerToken);
    expect(response.status).toBe(502);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining("reconnect") },
    });
  });

  it("streams an event-stream answer through", async () => {
    const tools = await upstream("sse");
    const session = (await gateway(() => [
      { key: "linear", pluginId: "linear", url: tools.url },
    ]).registerSession())!;
    const response = await listTools(session.servers[0]!.url, session.bearerToken);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe('data: {"n":1}\n\ndata: {"n":2}\n\n');
  });

  it("reports an unreachable tool server instead of hanging", async () => {
    const session = (await gateway(() => [
      { key: "linear", pluginId: "linear", url: "http://127.0.0.1:9/mcp" },
    ]).registerSession())!;
    const response = await listTools(session.servers[0]!.url, session.bearerToken);
    expect(response.status).toBe(502);
  });
});

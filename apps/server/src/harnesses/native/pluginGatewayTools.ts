// FILE: pluginGatewayTools.ts
// Purpose: The user's plugin tools as function tools for a harness that runs its own tool loop
//          (DJL Cloud). Lists and calls them through DJL's local plugin gateway with the chat's
//          bearer, speaking just enough of MCP's Streamable HTTP transport.

import { createHash, randomUUID } from "node:crypto";

import type { PluginGatewaySession } from "../../plugins/PluginGateway";

export interface PluginGatewayTool {
  /** Function name the model sees: the gateway server name and the tool's own name. */
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly url: string;
  readonly remoteName: string;
}

interface Connection {
  readonly url: string;
  readonly sessionId: string | null;
}

const MAX_TOOL_PAGES = 10;
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * OpenAI-style function names allow letters, digits, `_` and `-`, up to 64 characters. A name
 * that had to be shortened or reshaped gets a hash of the real names, so two tools cannot end up
 * sharing one by accident.
 */
export function pluginFunctionName(server: string, tool: string): string {
  const exact = `${server}__${tool}`;
  const safe = exact.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (safe === exact && safe.length <= 64) return safe;
  const hash = createHash("sha256").update(`${server}\u0000${tool}`).digest("hex").slice(0, 8);
  return `${safe.slice(0, 55)}_${hash}`;
}

async function rpc(
  bearerToken: string,
  connection: Connection,
  method: string,
  params: unknown,
  signal: AbortSignal | undefined,
  notification = false,
): Promise<{ result: Record<string, unknown>; sessionId: string | null }> {
  const id = randomUUID();
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(connection.sessionId ? { "Mcp-Session-Id": connection.sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const sessionId = response.headers.get("mcp-session-id") ?? connection.sessionId;
  if (!response.ok) throw new Error(`The plugin server refused ${method} (${response.status}).`);
  if (notification) return { result: {}, sessionId };
  const text = await response.text();
  // A server may answer a POST with a JSON body or with an event stream carrying the reply.
  const messages = (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text
        .split(/\r?\n\r?\n/)
        .map((block) =>
          block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n"),
        )
        .filter(Boolean)
        .map((data) => JSON.parse(data) as Record<string, unknown>)
    : [JSON.parse(text) as Record<string, unknown>];
  const reply = messages.find((message) => message.id === id);
  if (!reply) throw new Error(`The plugin server did not answer ${method}.`);
  if (reply.error) {
    const error = reply.error as { message?: unknown };
    throw new Error(typeof error.message === "string" ? error.message : `${method} failed.`);
  }
  return { result: (reply.result ?? {}) as Record<string, unknown>, sessionId };
}

async function connect(
  bearerToken: string,
  url: string,
  signal: AbortSignal | undefined,
): Promise<Connection> {
  const initialized = await rpc(
    bearerToken,
    { url, sessionId: null },
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "DJL", version: "1.0.0" },
    },
    signal,
  );
  const connection = { url, sessionId: initialized.sessionId };
  await rpc(bearerToken, connection, "notifications/initialized", {}, signal, true);
  return connection;
}

/**
 * Every tool of every plugin in the session. A plugin that cannot be reached is left out so the
 * rest still work; the chat itself never fails over a plugin.
 */
export async function listPluginGatewayTools(
  plugins: PluginGatewaySession,
  signal?: AbortSignal,
): Promise<PluginGatewayTool[]> {
  const perServer = await Promise.all(
    plugins.servers.map(async (server) => {
      try {
        const connection = await connect(plugins.bearerToken, server.url, signal);
        const tools: PluginGatewayTool[] = [];
        let cursor: unknown;
        for (let page = 0; page < MAX_TOOL_PAGES; page++) {
          const { result } = await rpc(
            plugins.bearerToken,
            connection,
            "tools/list",
            cursor ? { cursor } : {},
            signal,
          );
          for (const entry of Array.isArray(result.tools) ? result.tools : []) {
            const tool = entry as { name?: unknown; description?: unknown; inputSchema?: unknown };
            if (typeof tool.name !== "string") continue;
            tools.push({
              name: pluginFunctionName(server.name, tool.name),
              description: typeof tool.description === "string" ? tool.description : tool.name,
              inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
              url: server.url,
              remoteName: tool.name,
            });
          }
          cursor = result.nextCursor;
          if (typeof cursor !== "string" || !cursor) break;
        }
        return tools;
      } catch {
        return [];
      }
    }),
  );
  // A name two tools still share is withheld from both: neither could be called unambiguously.
  const all = perServer.flat();
  return all.filter((tool) => all.filter((other) => other.name === tool.name).length === 1);
}

/** Calls one plugin tool. Throws with the tool's own message when it reports an error. */
export async function callPluginGatewayTool(
  plugins: PluginGatewaySession,
  tool: PluginGatewayTool,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const connection = await connect(plugins.bearerToken, tool.url, signal);
  const { result } = await rpc(
    plugins.bearerToken,
    connection,
    "tools/call",
    { name: tool.remoteName, arguments: args ?? {} },
    signal,
  );
  const content = Array.isArray(result.content)
    ? (result.content as { type?: unknown; text?: unknown }[])
    : [];
  const text = content
    .flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []))
    .join("\n");
  if (result.isError === true) throw new Error(text || "The plugin tool failed.");
  return result.structuredContent ?? (text || content);
}

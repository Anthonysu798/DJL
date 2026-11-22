// FILE: customServer.ts
// Purpose: Checks a tool server the user typed in before it is added, and works out how it
//          wants to be reached: openly, with an access token, or through a browser sign-in.

import type { PluginAppAuthType } from "@djl/contracts";

import { discoverEndpoints, type Fetch } from "./pluginOAuth";

const isLoopbackHost = (host: string) =>
  host === "127.0.0.1" || host === "localhost" || host === "[::1]";

/** Plain http is only for a server on this computer; anything else would send tokens in the clear. */
export function parseCustomServerUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter the server's full address, starting with https://");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("The address must start with https:// (http:// only works for localhost).");
  }
  if (url.username || url.password) {
    throw new Error("Remove the user name and password from the address.");
  }
  return url;
}

class AccessTokenRequired extends Error {}

export async function probeCustomServer(
  fetchFn: Fetch,
  url: string,
  accessToken?: string,
): Promise<PluginAppAuthType> {
  let response: Response;
  let text: string;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "DJL", version: "1.0.0" },
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    text = await response.text();
  } catch {
    throw new Error("DJL could not reach that address.");
  }
  if (response.ok && text.includes('"result"')) return accessToken ? "apiKey" : "none";
  if (response.status === 401 || response.status === 403) {
    if (accessToken) throw new Error("The server refused this access token.");
    const endpoints = await discoverEndpoints(fetchFn, url).catch(() => null);
    if (endpoints?.registrationEndpoint) return "oauth";
    throw new AccessTokenRequired("This server needs an access token. Add one and try again.");
  }
  throw new Error(`That address did not answer as a tool server (HTTP ${response.status}).`);
}

/** How a listed server signs in, found by asking it; a server that wants a token is "apiKey". */
export async function probeServerAuth(fetchFn: Fetch, url: string): Promise<PluginAppAuthType> {
  try {
    return await probeCustomServer(fetchFn, url);
  } catch (cause) {
    if (cause instanceof AccessTokenRequired) return "apiKey";
    throw cause;
  }
}

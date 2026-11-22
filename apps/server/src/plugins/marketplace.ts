// FILE: marketplace.ts
// Purpose: Reads plugin manifests: one the user uploads, and the list a marketplace serves.
//          Every manifest is checked against the contract; a marketplace's bad entries are
//          skipped and counted rather than failing the whole list.

import { decodePluginManifest, type PluginManifest } from "@synara/contracts";

import type { Fetch } from "./pluginOAuth";

export const MARKETPLACE_MAX_BYTES = 1_000_000;
const MARKETPLACE_TIMEOUT_MS = 15_000;
const MARKETPLACE_MAX_PLUGINS = 200;

/** One uploaded or pasted manifest. Errors name each wrong field. */
export function parseManifestText(text: string): PluginManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const result = decodePluginManifest(value);
  if (!result.ok) throw new Error(`This plugin manifest is not valid:\n${result.error}`);
  return result.manifest;
}

export function parseMarketplaceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter the marketplace's full address, starting with https://");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The marketplace address must start with https:// and hold no password.");
  }
  return url;
}

class MarketplaceTooBig extends Error {
  constructor() {
    super("The marketplace file is too big (the limit is 1 MB).");
  }
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MARKETPLACE_MAX_BYTES) throw new MarketplaceTooBig();
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MARKETPLACE_MAX_BYTES) {
      await reader.cancel();
      throw new MarketplaceTooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchMarketplace(
  fetchFn: Fetch,
  address: string,
): Promise<{ name: string; plugins: PluginManifest[]; skipped: number }> {
  const url = parseMarketplaceUrl(address).toString();
  let text: string;
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(MARKETPLACE_TIMEOUT_MS),
    });
    text = response.ok ? await readLimited(response) : "";
  } catch (cause) {
    if (cause instanceof MarketplaceTooBig) throw cause;
    throw new Error("DJL could not reach that address.", { cause });
  }
  if (!response.ok) throw new Error(`The marketplace did not load (HTTP ${response.status}).`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The marketplace file is not valid JSON.");
  }
  const file = value as { name?: unknown; plugins?: unknown };
  const name = typeof file?.name === "string" ? file.name.trim() : "";
  if (!name || name.length > 80 || !Array.isArray(file.plugins)) {
    throw new Error(
      'A marketplace file needs a name and a list of plugins: { "name", "plugins" }.',
    );
  }
  if (file.plugins.length > MARKETPLACE_MAX_PLUGINS) {
    throw new Error(`A marketplace can list at most ${MARKETPLACE_MAX_PLUGINS} plugins.`);
  }
  const plugins: PluginManifest[] = [];
  let skipped = 0;
  for (const item of file.plugins) {
    const result = decodePluginManifest(item);
    if (result.ok && !plugins.some((plugin) => plugin.id === result.manifest.id)) {
      plugins.push(result.manifest);
    } else {
      skipped += 1;
    }
  }
  return { name, plugins, skipped };
}

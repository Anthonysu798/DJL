// Opaque, expiring grants for rendered document PDFs. Filesystem paths never cross the API.

import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";

const DEFAULT_GRANT_TTL_MS = 2 * 60_000;

interface RegisteredPreview {
  readonly renderId: string;
  readonly filePath: string;
}

interface PreviewGrant {
  readonly renderId: string;
  readonly expiresAt: number;
}

const previews = new Map<string, RegisteredPreview>();
const grants = new Map<string, PreviewGrant>();

export async function registerDocumentPreview(renderId: string, filePath: string): Promise<void> {
  const resolved = await realpath(filePath);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("Rendered document preview is not a file.");
  previews.set(renderId, { renderId, filePath: resolved });
}

export function issueDocumentPreviewGrant(
  renderId: string,
  options?: { readonly now?: number; readonly ttlMs?: number },
): { readonly grant: string; readonly expiresAt: string } {
  if (!previews.has(renderId)) throw new Error("Rendered document preview is unavailable.");
  const now = options?.now ?? Date.now();
  const expiresAt = now + (options?.ttlMs ?? DEFAULT_GRANT_TTL_MS);
  const grant = randomBytes(32).toString("base64url");
  grants.set(grant, { renderId, expiresAt });
  return { grant, expiresAt: new Date(expiresAt).toISOString() };
}

export function resolveDocumentPreviewGrant(input: {
  readonly renderId: string;
  readonly grant: string;
  readonly now?: number;
}): string | null {
  const entry = grants.get(input.grant);
  if (!entry || entry.renderId !== input.renderId) return null;
  if (entry.expiresAt <= (input.now ?? Date.now())) {
    grants.delete(input.grant);
    return null;
  }
  return previews.get(input.renderId)?.filePath ?? null;
}

export function clearDocumentPreviewRegistryForTests(): void {
  previews.clear();
  grants.clear();
}

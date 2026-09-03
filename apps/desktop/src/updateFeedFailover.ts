export const CANONICAL_GITHUB_UPDATE_FEED = {
  provider: "github",
  owner: "Anthonysu798",
  repo: "DJL",
  releaseType: "release",
} as const;

export type GenericUpdateFeed = {
  readonly provider: "generic";
  readonly url: string;
};

export function resolveGenericUpdateFeed(
  rawConfig: Record<string, string> | null,
): GenericUpdateFeed | null {
  if (rawConfig?.provider !== "generic") return null;
  const candidate = rawConfig.url?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return { provider: "generic", url: url.toString().replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

const INTEGRITY_ERROR_CODES = new Set([
  "ERR_UPDATER_INVALID_SIGNATURE",
  "ERR_UPDATER_INVALID_UPDATE_INFO",
  "ERR_UPDATER_NO_FILES_PROVIDED",
  "ERR_UPDATER_NO_CHECKSUM",
]);

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().toLowerCase();
}

export function isEligibleUpdateFeedFailure(error: unknown): boolean {
  const code = errorCode(error);
  if (code && INTEGRITY_ERROR_CODES.has(code)) return false;
  const message = errorMessage(error);
  return !message.includes("checksum") && !message.includes("signature");
}

export async function runWithUpdateFeedFallback<T>(input: {
  readonly primary: () => Promise<T>;
  readonly fallback?: (() => Promise<T>) | undefined;
}): Promise<{ readonly source: "primary" | "github"; readonly value: T }> {
  try {
    return { source: "primary", value: await input.primary() };
  } catch (error) {
    if (!input.fallback || !isEligibleUpdateFeedFailure(error)) throw error;
    return { source: "github", value: await input.fallback() };
  }
}

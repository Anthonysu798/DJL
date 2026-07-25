// FILE: providerFailurePresentation.ts
// Purpose: Classifies noisy provider diagnostics into stable actionable UI categories.
// Layer: Pure web presentation logic

export type ProviderFailureKind =
  | "authentication"
  | "commandMissing"
  | "permission"
  | "connection"
  | "rateLimit"
  | "generic";

export function classifyProviderFailure(detail: string | null | undefined): ProviderFailureKind {
  const normalized = detail?.toLowerCase() ?? "";
  if (
    /\b(unauthori[sz]ed|authentication|credentials?|api[ _-]?key|sign[ -]?in|login)\b/.test(
      normalized,
    )
  ) {
    return "authentication";
  }
  if (
    /\b(command not found|enoent|executable not found|binary not found|not installed|spawn .* failed)\b/.test(
      normalized,
    )
  ) {
    return "commandMissing";
  }
  if (/\b(eacces|permission denied|operation not permitted|access denied)\b/.test(normalized)) {
    return "permission";
  }
  if (/\b(rate limit|too many requests|quota|429)\b/.test(normalized)) {
    return "rateLimit";
  }
  if (
    /\b(econnrefused|econnreset|socket|connection|network|timed? out|unreachable|disconnected)\b/.test(
      normalized,
    )
  ) {
    return "connection";
  }
  return "generic";
}

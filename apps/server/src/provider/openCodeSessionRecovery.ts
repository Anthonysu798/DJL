// FILE: openCodeSessionRecovery.ts
// Purpose: Classifies the OpenCode failure that can safely recover by creating a new native
//          session. Shared by startup validation and prompt-time recovery.
// Layer: Server provider utility

export function isOpenCodeSessionNotFoundDetail(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("session not found") ||
    normalized.includes("unknown session") ||
    normalized.includes("missing session")
  );
}

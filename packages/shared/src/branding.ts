// FILE: branding.ts
// Purpose: Owns the user-facing product name without changing legacy compatibility namespaces.
// Layer: Shared runtime utility

export const APP_BASE_NAME = "DJL" as const;

export function resolveAppDisplayName(isDevelopment: boolean): string {
  return isDevelopment ? `${APP_BASE_NAME} (Dev)` : APP_BASE_NAME;
}

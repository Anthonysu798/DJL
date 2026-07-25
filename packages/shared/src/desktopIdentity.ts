// FILE: desktopIdentity.ts
// Purpose: Defines the canonical desktop application identity across packaging and runtime.

export const SYNARA_DESKTOP_SCHEME = "synara";
export const SYNARA_DESKTOP_ORIGIN = `${SYNARA_DESKTOP_SCHEME}://app`;
export const SYNARA_DESKTOP_ENTRY_URL = `${SYNARA_DESKTOP_ORIGIN}/index.html`;
// The export name is retained for source compatibility; DJL is the public channel identity.
export const SYNARA_DESKTOP_UPDATE_CHANNEL = "djl";
export const SYNARA_PRODUCTION_BUNDLE_ID = "com.emanueledipietro.synara";
export const SYNARA_DEVELOPMENT_BUNDLE_ID = `${SYNARA_PRODUCTION_BUNDLE_ID}.dev`;

export function synaraBundleId(isDevelopment: boolean): string {
  return isDevelopment ? SYNARA_DEVELOPMENT_BUNDLE_ID : SYNARA_PRODUCTION_BUNDLE_ID;
}

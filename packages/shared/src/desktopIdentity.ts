// FILE: desktopIdentity.ts
// Purpose: Defines the canonical desktop application identity across packaging and runtime.

// The renderer loads from its own privileged scheme, separate from the djl:// deep links.
export const DJL_DESKTOP_SCHEME = "djl-app";
export const DJL_DESKTOP_ORIGIN = `${DJL_DESKTOP_SCHEME}://app`;
export const DJL_DESKTOP_ENTRY_URL = `${DJL_DESKTOP_ORIGIN}/index.html`;
export const DJL_DESKTOP_UPDATE_CHANNEL = "djl";
export const DJL_PRODUCTION_BUNDLE_ID = "app.djl.desktop";
export const DJL_DEVELOPMENT_BUNDLE_ID = `${DJL_PRODUCTION_BUNDLE_ID}.dev`;

export function djlBundleId(isDevelopment: boolean): string {
  return isDevelopment ? DJL_DEVELOPMENT_BUNDLE_ID : DJL_PRODUCTION_BUNDLE_ID;
}

export const DJL_DESKTOP_BUNDLE_ID_ENV = "DJL_DESKTOP_BUNDLE_ID";

"use client";
/**
 * What the browser tells the API about itself at sign-in. It is stored on
 * the login event for forensics. The device id is generated once per browser
 * profile and kept in localStorage; it is not a hardware id, and the API never
 * trusts any of this for authorization.
 */
export interface LoginClient {
  timezone: string;
  locale: string;
  platform: string;
  screen: string;
  deviceId: string;
}

const KEY = "djl-admin-device";

export function loginClient(): LoginClient {
  let deviceId = "";
  try {
    deviceId = localStorage.getItem(KEY) ?? "";
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(KEY, deviceId);
    }
  } catch {
    deviceId = "no-storage";
  }
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    locale: navigator.language ?? "",
    platform: nav.userAgentData?.platform ?? navigator.platform ?? "",
    screen: `${screen.width}x${screen.height}`,
    deviceId,
  };
}

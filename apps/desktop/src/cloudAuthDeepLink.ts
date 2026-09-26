/**
 * `djl://auth/callback?code=…&state=…` deep links from DJL Cloud browser
 * sign-in. The OS hands them over as a macOS `open-url` event or, on Windows
 * and Linux, as a command-line argument of a (second) app instance.
 *
 * Only the exact callback URL with a well-formed code and state is accepted.
 * The state is matched against the one the local server issued, single use,
 * before the code is redeemed there.
 */
export const CLOUD_AUTH_PROTOCOL = "djl";
export const CLOUD_AUTH_CALLBACK_CHANNEL = "desktop:cloud-auth-callback";
export const CLOUD_AUTH_TAKE_CALLBACK_CHANNEL = "desktop:cloud-auth-take-callback";

export interface CloudAuthCallback {
  readonly code: string;
  readonly state: string;
}

const TOKEN = /^[A-Za-z0-9_-]{16,256}$/;

export function parseCloudAuthCallbackUrl(raw: unknown): CloudAuthCallback | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${CLOUD_AUTH_PROTOCOL}:` || url.host !== "auth") return null;
  if (url.pathname !== "/callback" || url.username || url.password || url.hash) return null;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !TOKEN.test(code) || !TOKEN.test(state)) return null;
  return { code, state };
}

/** The first valid callback among command-line arguments (Windows and Linux). */
export function findCloudAuthCallbackInArgv(argv: readonly string[]): CloudAuthCallback | null {
  for (const arg of argv) {
    if (!arg.toLowerCase().startsWith(`${CLOUD_AUTH_PROTOCOL}://`)) continue;
    const callback = parseCloudAuthCallbackUrl(arg);
    if (callback) return callback;
  }
  return null;
}

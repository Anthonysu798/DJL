// FILE: apns.ts
// Purpose: Sends content-free DJL completion notifications through APNs token authentication.

export interface GenericPushInput {
  readonly threadId: string;
  readonly turnId?: string;
  readonly result: "completed" | "failed";
}

export interface ApnsConfiguration {
  readonly APNS_TEAM_ID?: string;
  readonly APNS_KEY_ID?: string;
  readonly APNS_BUNDLE_ID?: string;
  readonly APNS_PRIVATE_KEY?: string;
}

export interface SendGenericPushInput extends GenericPushInput {
  readonly deviceToken: string;
  readonly environment: "development" | "production";
}

export const buildGenericPushPayload = ({ threadId, turnId, result }: GenericPushInput) => ({
  aps: {
    alert: {
      title: "DJL task finished",
      body: "Open DJL to review the result.",
    },
    sound: "default",
  },
  source: "djl.runCompletion",
  threadId,
  turnId: turnId ?? "",
  result,
});

export const normalizeDeviceToken = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll(/[^a-fA-F0-9]/g, "").toLowerCase();
  return normalized.length >= 6 && normalized.length <= 200 ? normalized : null;
};

const textEncoder = new TextEncoder();

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

const jsonToBase64Url = (value: unknown): string =>
  bytesToBase64Url(textEncoder.encode(JSON.stringify(value)));

const importApnsPrivateKey = async (pem: string): Promise<CryptoKey> => {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replaceAll(/\s/g, "");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", bytes, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
};

const createAuthorizationToken = async (
  configuration: Required<ApnsConfiguration>,
  now = Date.now(),
): Promise<string> => {
  const header = jsonToBase64Url({ alg: "ES256", kid: configuration.APNS_KEY_ID });
  const claims = jsonToBase64Url({
    iss: configuration.APNS_TEAM_ID,
    iat: Math.floor(now / 1_000),
  });
  const signingInput = `${header}.${claims}`;
  const privateKey = await importApnsPrivateKey(configuration.APNS_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    textEncoder.encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
};

const requiredConfiguration = (
  configuration: ApnsConfiguration,
): Required<ApnsConfiguration> | null => {
  const APNS_TEAM_ID = configuration.APNS_TEAM_ID?.trim();
  const APNS_KEY_ID = configuration.APNS_KEY_ID?.trim();
  const APNS_BUNDLE_ID = configuration.APNS_BUNDLE_ID?.trim();
  const APNS_PRIVATE_KEY = configuration.APNS_PRIVATE_KEY?.trim();
  return APNS_TEAM_ID && APNS_KEY_ID && APNS_BUNDLE_ID && APNS_PRIVATE_KEY
    ? { APNS_TEAM_ID, APNS_KEY_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY }
    : null;
};

export const sendGenericPush = async (
  configuration: ApnsConfiguration,
  input: SendGenericPushInput,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> => {
  const resolved = requiredConfiguration(configuration);
  const deviceToken = normalizeDeviceToken(input.deviceToken);
  if (!resolved) return { ok: false, reason: "apns_not_configured" };
  if (!deviceToken) return { ok: false, reason: "invalid_device_token" };

  const authority =
    input.environment === "development"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";
  const response = await fetch(`${authority}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await createAuthorizationToken(resolved)}`,
      "apns-topic": resolved.APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildGenericPushPayload(input)),
  });
  if (response.ok) return { ok: true };

  let reason = `apns_http_${response.status}`;
  try {
    const body = (await response.json()) as { reason?: unknown };
    if (typeof body.reason === "string" && body.reason.length <= 160) reason = body.reason;
  } catch {
    // APNs occasionally closes without a JSON error body; retain the bounded status reason.
  }
  return { ok: false, reason };
};

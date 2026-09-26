/**
 * Apple Push Notification service with token-based (ES256 JWT) auth, ported
 * from apps/remote-relay/src/apns.ts. Payloads are content-free: they say a
 * task finished and carry ids, never the prompt or the reply.
 *
 * APNs only speaks HTTP/2, so production posts through node:http2.
 */
import http2 from "node:http2";

export type PushEnvironment = "production" | "sandbox";

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** Extra top-level keys for the app (ids only). */
  readonly data: Readonly<Record<string, string>>;
}

export type PushResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly unregistered: boolean };

export interface PushSender {
  readonly send: (input: {
    readonly token: string;
    readonly environment: PushEnvironment;
    readonly message: PushMessage;
  }) => Promise<PushResult>;
}

export interface ApnsConfig {
  readonly keyId: string;
  readonly teamId: string;
  /** The .p8 key's PKCS#8 PEM. */
  readonly privateKey: string;
  /** The app's bundle id, e.g. app.djl.ios. */
  readonly topic: string;
}

/** One HTTP/2 POST; injectable so tests never reach Apple. */
export type ApnsPost = (request: {
  readonly origin: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}) => Promise<{ readonly status: number; readonly body: string }>;

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

async function importKey(pem: string): Promise<CryptoKey> {
  const der = Buffer.from(
    pem
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replaceAll(/\s/g, ""),
    "base64",
  );
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

/** The provider authentication token APNs expects in `authorization: bearer`. */
export async function createApnsJwt(config: ApnsConfig, nowMs: number): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "ES256", kid: config.keyId })));
  const claims = base64Url(
    encoder.encode(JSON.stringify({ iss: config.teamId, iat: Math.floor(nowMs / 1000) })),
  );
  const input = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importKey(config.privateKey),
    encoder.encode(input),
  );
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

export const normalizeDeviceToken = (value: string): string | null => {
  const token = value.replaceAll(/[^a-fA-F0-9]/g, "").toLowerCase();
  return token.length >= 32 && token.length <= 200 ? token : null;
};

const http2Post: ApnsPost = ({ origin, path, headers, body }) =>
  new Promise((resolve, reject) => {
    const session = http2.connect(origin);
    session.on("error", reject);
    const request = session.request({ ":method": "POST", ":path": path, ...headers });
    let status = 0;
    let text = "";
    request.setEncoding("utf8");
    request.setTimeout(10_000, () => request.close(http2.constants.NGHTTP2_CANCEL));
    request.on("response", (h) => (status = Number(h[":status"] ?? 0)));
    request.on("data", (chunk: string) => (text += chunk));
    request.on("end", () => {
      session.close();
      resolve({ status, body: text });
    });
    request.on("error", (error) => {
      session.close();
      reject(error);
    });
    request.end(body);
  });

/** Reasons meaning the token will never work again; the caller should forget it. */
const UNREGISTERED = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export function createApnsSender(
  config: ApnsConfig,
  options: { readonly post?: ApnsPost; readonly now?: () => number } = {},
): PushSender {
  const post = options.post ?? http2Post;
  const now = options.now ?? Date.now;
  // APNs accepts a token for an hour and rejects refreshing more than every 20 minutes.
  let jwt: { readonly value: string; readonly at: number } | null = null;
  return {
    async send({ token, environment, message }) {
      const device = normalizeDeviceToken(token);
      if (!device) return { ok: false, reason: "invalid_device_token", unregistered: true };
      if (!jwt || now() - jwt.at > 50 * 60_000)
        jwt = { value: await createApnsJwt(config, now()), at: now() };
      const response = await post({
        origin:
          environment === "sandbox"
            ? "https://api.sandbox.push.apple.com"
            : "https://api.push.apple.com",
        path: `/3/device/${device}`,
        headers: {
          authorization: `bearer ${jwt.value}`,
          "apns-topic": config.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          aps: { alert: { title: message.title, body: message.body }, sound: "default" },
          ...message.data,
        }),
      });
      if (response.status === 200) return { ok: true };
      let reason = `apns_http_${response.status}`;
      try {
        const parsed = JSON.parse(response.body) as { reason?: unknown };
        if (typeof parsed.reason === "string") reason = parsed.reason.slice(0, 160);
      } catch {
        // APNs sometimes answers without a JSON body; keep the status.
      }
      return {
        ok: false,
        reason,
        unregistered: response.status === 410 || UNREGISTERED.has(reason),
      };
    },
  };
}

/** Captures pushes in memory (local development and tests). */
export class MockPushSender implements PushSender {
  readonly sent: { token: string; environment: PushEnvironment; message: PushMessage }[] = [];
  /** Tokens that answer as unregistered. */
  readonly dead = new Set<string>();

  async send(input: {
    readonly token: string;
    readonly environment: PushEnvironment;
    readonly message: PushMessage;
  }): Promise<PushResult> {
    if (this.dead.has(input.token))
      return { ok: false, reason: "Unregistered", unregistered: true };
    this.sent.push({ ...input });
    return { ok: true };
  }
}

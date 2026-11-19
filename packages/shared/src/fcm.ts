export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export type FcmResult = { ok: true } | { ok: false; reason: string; unregistered?: boolean };

const tokenUrl = "https://oauth2.googleapis.com/token";
const encode = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

/** Content-free Android delivery, shared by the Cloud API and paired relay. */
export function createFcmSender(
  config: FcmConfig,
  options: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let authorization: { value: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  async function authorize(): Promise<string> {
    if (authorization && authorization.expiresAt > now() + 60_000) return authorization.value;
    if (pending) return pending;
    pending = (async () => {
      const pem = config.privateKey.replace(
        /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
        "",
      );
      const key = await crypto.subtle.importKey(
        "pkcs8",
        Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const issuedAt = Math.floor(now() / 1000);
      const json = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));
      const unsigned = `${json({ alg: "RS256", typ: "JWT" })}.${json({
        iss: config.clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: tokenUrl,
        iat: issuedAt,
        exp: issuedAt + 3600,
      })}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(unsigned),
      );
      const response = await request(tokenUrl, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: `${unsigned}.${encode(new Uint8Array(signature))}`,
        }),
      });
      if (!response.ok) throw new Error("fcm_auth_failed");
      const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
      if (
        typeof body.access_token !== "string" ||
        !body.access_token ||
        typeof body.expires_in !== "number" ||
        !Number.isFinite(body.expires_in) ||
        body.expires_in <= 60
      ) {
        throw new Error("fcm_auth_failed");
      }
      authorization = {
        value: body.access_token,
        expiresAt: now() + Math.min(body.expires_in, 3600) * 1000,
      };
      return authorization.value;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  }

  return {
    async send(input: {
      installationId: string;
      data: Readonly<Record<string, string>>;
    }): Promise<FcmResult> {
      for (let attempt = 0; attempt < 2; attempt++) {
        let credential: string;
        try {
          credential = await authorize();
        } catch {
          return { ok: false, reason: "fcm_auth_failed" };
        }
        let response: Response;
        try {
          response = await request(
            `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
            {
              method: "POST",
              signal: AbortSignal.timeout(10_000),
              headers: {
                authorization: `Bearer ${credential}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                message: {
                  fid: input.installationId,
                  data: input.data,
                  android: { priority: "HIGH", ttl: "300s" },
                },
              }),
            },
          );
        } catch {
          return { ok: false, reason: "fcm_network_failed" };
        }
        if (response.ok) return { ok: true };
        if (response.status === 401 && attempt === 0) {
          // Do not evict a credential another request has already refreshed.
          if (authorization?.value === credential) authorization = undefined;
          continue;
        }
        try {
          const body = (await response.json()) as { error?: { details?: unknown } };
          if (
            response.status === 404 &&
            Array.isArray(body.error?.details) &&
            body.error.details.some(
              (detail) =>
                detail?.["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
                detail?.errorCode === "UNREGISTERED",
            )
          )
            return { ok: false, reason: "fcm_unregistered", unregistered: true };
        } catch {
          /* Provider bodies are never included in returned errors. */
        }
        return { ok: false, reason: `fcm_http_${response.status}` };
      }
      return { ok: false, reason: "fcm_http_401" };
    },
  };
}

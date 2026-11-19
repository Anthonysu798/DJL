import { beforeAll, describe, expect, it } from "vitest";

import { createFcmSender } from "./fcm";

let privateKey: string;
let publicKey: CryptoKey;
const now = 1_800_000_000_000;
const config = () => ({
  projectId: "djl-test-only",
  clientEmail: "sender@test.invalid",
  privateKey,
});
const input = { installationId: "AbC_Fid-123", data: { source: "djl.cloudRun", runId: "run-1" } };
const oauth = () => Response.json({ access_token: "test-only-access", expires_in: 3600 });

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  publicKey = pair.publicKey;
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  privateKey = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----`;
});

describe("FCM HTTP v1 sender", () => {
  it("signs a scoped OAuth assertion and sends a data-only case-sensitive FID", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const sender = createFcmSender(config(), {
      now: () => now,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init! });
        return requests.length === 1
          ? oauth()
          : Response.json({ name: "projects/test/messages/1" });
      },
    });
    expect(await sender.send(input)).toEqual({ ok: true });
    const auth = requests[0]!;
    expect(auth.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(auth.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = form.get("assertion")!;
    const [header, payload, signature] = assertion.split(".");
    expect(JSON.parse(atob(header!))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(atob(payload!))).toEqual({
      iss: "sender@test.invalid",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: auth.url,
      iat: now / 1000,
      exp: now / 1000 + 3600,
    });
    const signatureBytes = Uint8Array.from(
      atob(signature!.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        signatureBytes,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).toBe(true);
    expect(requests[1]!.url).toBe(
      "https://fcm.googleapis.com/v1/projects/djl-test-only/messages:send",
    );
    expect(new Headers(requests[1]!.init.headers).get("authorization")).toBe(
      "Bearer test-only-access",
    );
    expect(JSON.parse(String(requests[1]!.init.body))).toEqual({
      message: {
        fid: input.installationId,
        data: input.data,
        android: { priority: "HIGH", ttl: "300s" },
      },
    });
  });

  it("coalesces authorization and refreshes before expiry", async () => {
    let current = now;
    let exchanges = 0;
    const sender = createFcmSender(config(), {
      now: () => current,
      fetch: async (url) => {
        if (String(url).includes("oauth2")) {
          exchanges++;
          return oauth();
        }
        return Response.json({ name: "delivered" });
      },
    });
    expect(await Promise.all([sender.send(input), sender.send(input)])).toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(exchanges).toBe(1);
    await sender.send(input);
    expect(exchanges).toBe(1);
    current += 3_541_000;
    await sender.send(input);
    expect(exchanges).toBe(2);
  });

  it("refreshes once on unauthorized delivery and bounds a repeated rejection", async () => {
    let exchanges = 0;
    let deliveries = 0;
    const sender = createFcmSender(config(), {
      fetch: async (url) => {
        if (String(url).includes("oauth2")) {
          exchanges++;
          return oauth();
        }
        deliveries++;
        return new Response("private provider details", { status: 401 });
      },
    });
    expect(await sender.send(input)).toEqual({ ok: false, reason: "fcm_http_401" });
    expect(exchanges).toBe(2);
    expect(deliveries).toBe(2);
  });

  it("revokes only an explicit FCM UNREGISTERED response", async () => {
    let dead = false;
    const sender = createFcmSender(config(), {
      fetch: async (url) =>
        String(url).includes("oauth2")
          ? oauth()
          : Response.json(
              {
                error: {
                  status: "NOT_FOUND",
                  details: dead
                    ? [
                        {
                          "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                          errorCode: "UNREGISTERED",
                        },
                      ]
                    : [],
                },
              },
              { status: 404 },
            ),
    });
    expect(await sender.send(input)).toEqual({ ok: false, reason: "fcm_http_404" });
    dead = true;
    expect(await sender.send(input)).toEqual({
      ok: false,
      reason: "fcm_unregistered",
      unregistered: true,
    });
  });

  it("keeps authorization and network errors private", async () => {
    const failed = createFcmSender(config(), {
      fetch: async () => new Response("private credential details", { status: 400 }),
    });
    expect(await failed.send(input)).toEqual({ ok: false, reason: "fcm_auth_failed" });
    const offline = createFcmSender(config(), {
      fetch: async () => {
        throw new Error(privateKey);
      },
    });
    expect(await offline.send(input)).toEqual({ ok: false, reason: "fcm_auth_failed" });
    const invalid = createFcmSender({ ...config(), privateKey: "invalid" });
    expect(await invalid.send(input)).toEqual({ ok: false, reason: "fcm_auth_failed" });
  });

  it("does not cache malformed authorization responses", async () => {
    let exchanges = 0;
    const sender = createFcmSender(config(), {
      fetch: async () => {
        exchanges++;
        return Response.json({ access_token: "x", expires_in: "3600" });
      },
    });
    expect(await sender.send(input)).toEqual({ ok: false, reason: "fcm_auth_failed" });
    expect(await sender.send(input)).toEqual({ ok: false, reason: "fcm_auth_failed" });
    expect(exchanges).toBe(2);
  });
});

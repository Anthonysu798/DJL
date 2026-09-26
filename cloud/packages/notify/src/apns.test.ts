import { describe, expect, it } from "vitest";

import { createApnsJwt, createApnsSender, type ApnsPost } from "./apns.ts";

async function testKey() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString("base64")}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

const fromBase64Url = (s: string) => Buffer.from(s, "base64url");

describe("APNs", () => {
  it("signs an ES256 provider token that verifies with the key's public half", async () => {
    const { pem, publicKey } = await testKey();
    const jwt = await createApnsJwt(
      { keyId: "KEY123", teamId: "TEAM456", privateKey: pem, topic: "app.djl.ios" },
      1_700_000_000_000,
    );
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(fromBase64Url(header!).toString())).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(fromBase64Url(claims!).toString())).toEqual({
      iss: "TEAM456",
      iat: 1_700_000_000,
    });
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      fromBase64Url(signature!),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it("posts a content-free alert to the right host and topic, reusing the token", async () => {
    const { pem } = await testKey();
    const posts: Parameters<ApnsPost>[0][] = [];
    const sender = createApnsSender(
      { keyId: "K", teamId: "T", privateKey: pem, topic: "app.djl.ios" },
      { post: async (r) => (posts.push(r), { status: 200, body: "" }) },
    );
    const token = "ab".repeat(32);
    const message = { title: "Task finished", body: "Open DJL", data: { runId: "r1" } };
    expect(await sender.send({ token, environment: "sandbox", message })).toEqual({ ok: true });
    await sender.send({ token, environment: "production", message });
    expect(posts[0]).toMatchObject({
      origin: "https://api.sandbox.push.apple.com",
      path: `/3/device/${token}`,
      headers: { "apns-topic": "app.djl.ios", "apns-push-type": "alert" },
    });
    expect(posts[1]!.origin).toBe("https://api.push.apple.com");
    expect(posts[0]!.headers.authorization).toBe(posts[1]!.headers.authorization);
    expect(JSON.parse(posts[0]!.body)).toEqual({
      aps: { alert: { title: "Task finished", body: "Open DJL" }, sound: "default" },
      runId: "r1",
    });
  });

  it("reports unregistered tokens so they can be revoked", async () => {
    const { pem } = await testKey();
    const sender = createApnsSender(
      { keyId: "K", teamId: "T", privateKey: pem, topic: "app.djl.ios" },
      { post: async () => ({ status: 410, body: JSON.stringify({ reason: "Unregistered" }) }) },
    );
    const result = await sender.send({
      token: "cd".repeat(32),
      environment: "production",
      message: { title: "t", body: "b", data: {} },
    });
    expect(result).toEqual({ ok: false, reason: "Unregistered", unregistered: true });
  });
});

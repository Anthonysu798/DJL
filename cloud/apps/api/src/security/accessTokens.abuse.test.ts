/**
 * Red team: 15-minute access tokens. Only tokens we signed, for our audience
 * and issuer, unexpired, and from a live session may pass the guard.
 */
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ACCESS_TOKEN_AUDIENCE, makeAccessTokenVerifier } from "../auth/accessTokens.ts";
import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";

const ISSUER = "https://api.example.test";

async function keyPair(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "EdDSA" };
  return { privateKey, jwk };
}

function sign(
  key: CryptoKey,
  kid: string,
  claims: { aud?: string; iss?: string; exp?: string | number; sid?: string } = {},
) {
  return new SignJWT({ sid: claims.sid ?? "session-1" })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setSubject("user-1")
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? ACCESS_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? "15m")
    .sign(key);
}

describe("access token verifier", () => {
  it("accepts a well-formed token and rejects wrong audience, issuer, expiry, and key", async () => {
    const good = await keyPair("k1");
    const rogue = await keyPair("k1");
    const verify = makeAccessTokenVerifier({
      issuer: ISSUER,
      loadJwks: async () => ({ keys: [good.jwk] }),
    });
    expect(await verify(await sign(good.privateKey, "k1"))).toEqual({
      userId: "user-1",
      sessionId: "session-1",
    });
    expect(await verify(await sign(good.privateKey, "k1", { aud: "someone-else" }))).toBeNull();
    expect(
      await verify(await sign(good.privateKey, "k1", { iss: "https://evil.test" })),
    ).toBeNull();
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(await verify(await sign(good.privateKey, "k1", { exp: past }))).toBeNull();
    expect(await verify(await sign(rogue.privateKey, "k1"))).toBeNull();
    const [header, payload] = (await sign(good.privateKey, "k1")).split(".");
    const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${payload}.`;
    expect(await verify(unsigned)).toBeNull();
    expect(await verify(`${header}.${payload}.AAAA`)).toBeNull();
  });

  it("picks up a rotated key once, without refetching on every unknown kid", async () => {
    const first = await keyPair("k1");
    const second = await keyPair("k2");
    let loads = 0;
    let keys = [first.jwk];
    const verify = makeAccessTokenVerifier({
      issuer: ISSUER,
      loadJwks: async () => {
        loads += 1;
        return { keys };
      },
    });
    expect(await verify(await sign(first.privateKey, "k1"))).not.toBeNull();
    keys = [first.jwk, second.jwk];
    // Loaded moments ago, so an unknown kid is refused rather than refetched (no DoS lever).
    expect(await verify(await sign(second.privateKey, "k2"))).toBeNull();
    expect(loads).toBe(1);
  });
});

describe("access tokens over HTTP", () => {
  let api: ApiRuntime;
  let client: TestClient;

  beforeAll(async () => {
    const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
    api = await startApi({ env, port: 0, host: "127.0.0.1" });
    client = TestClient.for(api);
  });
  afterAll(async () => {
    await api.close();
  });

  it("exchanges a session token for a JWT that works until its session is revoked", async () => {
    const { email, password } = await client.signUp(api, "jwt");
    const signIn = await new TestClient(client.base).call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email, password },
    });
    const sessionToken = signIn.headers.get("set-auth-token");
    expect(sessionToken).toBeTruthy();

    const minted = await client.call("/v1/auth/token", { bearer: sessionToken! });
    expect(minted.status).toBe(200);
    const { token } = (await minted.json()) as { token: string };
    expect(token.split(".")).toHaveLength(3);
    expect((await client.call("/v1/me", { bearer: token })).status).toBe(200);

    const signOut = await client.call("/v1/auth/sign-out", {
      method: "POST",
      bearer: sessionToken!,
      json: {},
    });
    expect(signOut.status).toBe(200);
    const after = await client.call("/v1/me", { bearer: token });
    expect(after.status).toBe(401);
    expect((await after.json()).error.code).toBe("session_revoked");
    expect((await client.call("/v1/me", { bearer: sessionToken! })).status).toBe(401);
  });

  it("rejects a JWT whose signature was tampered with", async () => {
    const { email, password } = await client.signUp(api, "jwt-tamper");
    const signIn = await new TestClient(client.base).call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email, password },
    });
    const minted = await client.call("/v1/auth/token", {
      bearer: signIn.headers.get("set-auth-token")!,
    });
    const { token } = (await minted.json()) as { token: string };
    const [header, payload] = token.split(".");
    const forged = `${header}.${payload}.${Buffer.alloc(64).toString("base64url")}`;
    const res = await client.call("/v1/me", { bearer: forged });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_token");
  });
});

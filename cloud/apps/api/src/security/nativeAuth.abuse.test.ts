/**
 * Red team: desktop browser sign-in (PKCE S256). A code must only ever turn
 * into a session once, for the exact client and redirect it was minted for,
 * by the holder of the verifier, within 60 seconds.
 */
import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";

const REDIRECT = "djl://auth/callback";
let api: ApiRuntime;
let browser: TestClient;
let account: Awaited<ReturnType<TestClient["signUp"]>>;

const verifierAndChallenge = () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

async function mint(overrides: Record<string, unknown> = {}, client = browser) {
  const pkce = verifierAndChallenge();
  const res = await client.call("/v1/native-auth/codes", {
    method: "POST",
    json: {
      clientId: "djl-desktop",
      redirectUri: REDIRECT,
      state: randomBytes(16).toString("base64url"),
      codeChallenge: pkce.challenge,
      codeChallengeMethod: "S256",
      ...overrides,
    },
  });
  const body = (await res.json()) as { redirectTo?: string; error?: { code: string } };
  const code = body.redirectTo ? new URL(body.redirectTo).searchParams.get("code") : null;
  return { res, body, code, verifier: pkce.verifier };
}

function redeem(input: Record<string, unknown>) {
  return new TestClient(browser.base).call("/v1/native-auth/token", {
    method: "POST",
    json: { clientId: "djl-desktop", redirectUri: REDIRECT, ...input },
  });
}

beforeAll(async () => {
  const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
  browser = TestClient.for(api);
  account = await browser.signUp(api, "native");
});
afterAll(async () => {
  await api.close();
});

describe("native auth codes", () => {
  it("redirects to the app with code and state, and the code buys a working session once", async () => {
    const state = randomBytes(16).toString("base64url");
    const { res, body, code, verifier } = await mint({ state });
    expect(res.status).toBe(201);
    const redirect = new URL(body.redirectTo!);
    expect(`${redirect.protocol}//${redirect.host}${redirect.pathname}`).toBe(REDIRECT);
    expect(redirect.searchParams.get("state")).toBe(state);

    const token = await redeem({ code, codeVerifier: verifier });
    expect(token.status).toBe(200);
    const session = (await token.json()) as { sessionToken: string; userId: string };
    expect(session.userId).toBe(account.userId);
    const me = await browser.call("/v1/me", { bearer: session.sessionToken });
    expect(me.status).toBe(200);

    const replay = await redeem({ code, codeVerifier: verifier });
    expect(replay.status).toBe(400);
    expect((await replay.json()).error.code).toBe("invalid_grant");
  });

  it("burns the code on a wrong verifier so the right one cannot follow", async () => {
    const { code, verifier } = await mint();
    const wrong = await redeem({ code, codeVerifier: verifierAndChallenge().verifier });
    expect(wrong.status).toBe(400);
    expect((await redeem({ code, codeVerifier: verifier })).status).toBe(400);
  });

  it("refuses an expired code", async () => {
    const { code, verifier } = await mint();
    const hash = createHash("sha256").update(code!).digest("base64url");
    await api.db
      .update(schema.nativeAuthCodes)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.nativeAuthCodes.codeHash, hash));
    const res = await redeem({ code, codeVerifier: verifier });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_grant");
  });

  it("refuses a code redeemed with a tampered redirect URI or client id", async () => {
    const a = await mint();
    expect(
      (await redeem({ code: a.code, codeVerifier: a.verifier, redirectUri: "djl://evil/callback" }))
        .status,
    ).toBe(400);
    const b = await mint();
    expect(
      (await redeem({ code: b.code, codeVerifier: b.verifier, clientId: "djl-cli" })).status,
    ).toBe(400);
  });

  it("never mints for an unknown client or an unlisted redirect URI", async () => {
    for (const overrides of [
      { redirectUri: "https://evil.example/callback" },
      { redirectUri: "djl://auth/callback/../steal" },
      { clientId: "djl-unknown" },
      { codeChallengeMethod: "plain" },
    ]) {
      const { res } = await mint(overrides);
      expect(res.status).toBe(400);
    }
  });

  it("only mints from a browser session, never from a bearer credential", async () => {
    const { code, verifier } = await mint();
    const session = (await (await redeem({ code, codeVerifier: verifier })).json()) as {
      sessionToken: string;
    };
    const res = await browser.call("/v1/native-auth/codes", {
      method: "POST",
      bearer: session.sessionToken,
      json: {},
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("browser_session_required");
  });

  it("requires the CSRF token and a trusted origin to mint", async () => {
    const noToken = await browser.call("/v1/native-auth/codes", {
      method: "POST",
      csrf: false,
      json: {},
    });
    expect(noToken.status).toBe(403);
    expect((await noToken.json()).error.code).toBe("csrf_token");
    const evil = await browser.call("/v1/native-auth/codes", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      json: {},
    });
    expect(evil.status).toBe(403);
    expect((await evil.json()).error.code).toBe("csrf_origin");
  });

  it("refuses to open a session for an account suspended after the code was minted", async () => {
    const client = TestClient.for(api);
    const other = await client.signUp(api, "native-banned");
    const { code, verifier } = await mint({}, client);
    await api.db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, other.userId));
    const res = await redeem({ code, codeVerifier: verifier });
    expect(res.status).toBe(403);
  });
});

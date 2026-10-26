import { describe, expect, it, vi } from "vitest";
import {
  createSocialProviders,
  InstagramProvider,
  TikTokProvider,
  type ProviderTokens,
} from "./index";
const tokens: ProviderTokens = {
  accessToken: "fixture-access",
  refreshToken: "fixture-refresh",
  expiresAt: "2027-01-01T00:00:00Z",
  scope: [
    "user.info.basic",
    "video.publish",
    "video.list",
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
  ],
};
function fixtures(...bodies: unknown[]) {
  const fn = Object.assign(vi.fn(), { preconnect: vi.fn() });
  for (const body of bodies) fn.mockResolvedValueOnce(new Response(JSON.stringify(body)));
  return fn;
}
const instagram = (fetcher: typeof fetch) =>
  new InstagramProvider(
    { clientId: "fixture-id", clientSecret: "fixture-secret", graphVersion: "v25.0" },
    { fetch: fetcher, now: () => 0 },
  );
const tiktok = (fetcher: typeof fetch) =>
  new TikTokProvider(
    { clientKey: "fixture-key", clientSecret: "fixture-secret" },
    { fetch: fetcher, now: () => 0 },
  );
const creator = {
  data: {
    creator_username: "fixture",
    creator_nickname: "Fixture Creator",
    privacy_level_options: ["SELF_ONLY"],
    duet_disabled: true,
    stitch_disabled: true,
    comment_disabled: false,
    max_video_post_duration_sec: 60,
  },
  error: { code: "ok" },
};
const post = {
  videoUrl: "https://media.example/video.mp4",
  title: "Fixture",
  privacyLevel: "SELF_ONLY",
  disableDuet: true,
  disableStitch: true,
  disableComment: false,
  brandContent: false,
  brandOrganic: false,
  isAigc: true,
};
// All responses in this suite are injected fixtures, not live integration evidence.
describe("official social provider fixtures", () => {
  it("disables unconfigured providers and never exposes secrets in authorization URL", () => {
    expect(createSocialProviders({})).toEqual({});
    const url = new URL(
      tiktok(fixtures()).authorizationUrl({
        state: "state",
        redirectUri: "https://app.example/callback",
        codeChallenge: "challenge",
      }),
    );
    expect(url.origin).toBe("https://www.tiktok.com");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.toString()).not.toContain("secret");
  });
  it("exchanges TikTok code with PKCE and records returned scopes, not requested scopes", async () => {
    const fetcher = fixtures({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 3600,
      open_id: "user",
      scope: "user.info.basic",
    });
    const result = await tiktok(fetcher as typeof fetch).exchangeCode({
      code: "code",
      redirectUri: "https://app.example/callback",
      codeVerifier: "verifier",
    });
    expect(result.scope).toEqual(["user.info.basic"]);
    expect(result.expiresAt).toBe("1970-01-01T01:00:00.000Z");
    const body = fetcher.mock.calls[0]?.[1].body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("grant_type")).toBe("authorization_code");
  });
  it("persists rotated TikTok refresh tokens and reduced permissions", async () => {
    const fetcher = fixtures({
      access_token: "new",
      refresh_token: "rotated",
      expires_in: 3600,
      open_id: "user",
      scope: "user.info.basic",
    });
    expect((await tiktok(fetcher as typeof fetch).refresh(tokens)).refreshToken).toBe("rotated");
    expect(fetcher.mock.calls[0]?.[1].body.get("refresh_token")).toBe("fixture-refresh");
  });
  it("exchanges Instagram short token and verifies actual permission grants", async () => {
    const fetcher = fixtures(
      { access_token: "short" },
      { access_token: "long", expires_in: 5184000 },
      {
        data: [
          { permission: "instagram_business_basic", status: "granted" },
          { permission: "instagram_business_content_publish", status: "declined" },
        ],
      },
    );
    const result = await instagram(fetcher as typeof fetch).exchangeCode({
      code: "code",
      redirectUri: "https://app.example/callback",
    });
    expect(result.scope).toEqual(["instagram_business_basic"]);
    expect(result.accessToken).toBe("long");
    expect(fetcher.mock.calls[2]?.[0]).toContain("/me/permissions");
  });
  it.each(["instagram_business_basic", ["instagram_business_basic"]])(
    "accepts the single-account Instagram token envelope with returned grants %j",
    async (permissions) => {
      const fetcher = fixtures(
        { data: [{ access_token: "short", user_id: "123", permissions }] },
        { access_token: "long", expires_in: 5184000 },
      );
      const result = await instagram(fetcher as typeof fetch).exchangeCode({
        code: "code",
        redirectUri: "https://app.example/callback",
      });
      expect(result.scope).toEqual(["instagram_business_basic"]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("does not replace explicitly empty grants with requested scopes", async () => {
    const fetcher = fixtures(
      { access_token: "short", permissions: [] },
      { access_token: "long", expires_in: 5184000 },
    );
    expect(
      (
        await instagram(fetcher as typeof fetch).exchangeCode({
          code: "code",
          redirectUri: "https://app.example/callback",
        })
      ).scope,
    ).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { data: [] },
    { data: [{ access_token: "a" }, { access_token: "b" }] },
    { access_token: "short", permissions: 42 },
  ])("rejects ambiguous or malformed Instagram grants %j", async (body) => {
    const fetcher = fixtures(body);
    await expect(
      instagram(fetcher as typeof fetch).exchangeCode({
        code: "code",
        redirectUri: "https://app.example/callback",
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refreshes Instagram long-lived tokens without inventing a refresh token", async () => {
    const fetcher = fixtures({ access_token: "refreshed", expires_in: 5184000 });
    const result = await instagram(fetcher as typeof fetch).refresh({
      ...tokens,
      refreshToken: undefined,
    } as unknown as ProviderTokens);
    expect(result.accessToken).toBe("refreshed");
    expect(new URL(fetcher.mock.calls[0]?.[0]).searchParams.get("grant_type")).toBe(
      "ig_refresh_token",
    );
  });
  it("revokes provider authorization at the official endpoints", async () => {
    const igFetch = fixtures({ success: true });
    await instagram(igFetch as typeof fetch).revoke(tokens);
    expect(igFetch.mock.calls[0]?.[0]).toContain("/me/permissions");
    expect(igFetch.mock.calls[0]?.[1].method).toBe("DELETE");
    const ttFetch = fixtures({});
    await tiktok(ttFetch as typeof fetch).revoke(tokens);
    expect(ttFetch.mock.calls[0]?.[0]).toBe("https://open.tiktokapis.com/v2/oauth/revoke/");
    expect(ttFetch.mock.calls[0]?.[1].body.get("token")).toBe("fixture-access");
  });
  it("does not report a false Instagram revoke response as success", async () => {
    await expect(
      instagram(fixtures({ success: false }) as typeof fetch).revoke(tokens),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("rejects malformed token expiration", async () => {
    const provider = tiktok(
      fixtures({
        access_token: "new",
        refresh_token: "r",
        open_id: "u",
        scope: "user.info.basic",
        expires_in: -1,
      }) as typeof fetch,
    );
    await expect(provider.refresh(tokens)).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("marks TikTok initialization without a receipt uncertain and never retries", async () => {
    const fetcher = fixtures(creator, { data: {}, error: { code: "ok" } });
    await expect(tiktok(fetcher as typeof fetch).publishVideo(tokens, post)).rejects.toMatchObject({
      kind: "uncertain",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not claim publication capability when professional account evidence is absent", async () => {
    const provider = instagram(fixtures({ id: "123", username: "fixture" }) as typeof fetch);
    expect((await provider.account(tokens)).capabilities.publish).toBe(false);
  });
  it("checks scope before any publication request", async () => {
    const fetcher = fixtures();
    await expect(
      instagram(fetcher as typeof fetch).publishContainer({ ...tokens, scope: [] }, "123", "456"),
    ).rejects.toMatchObject({ kind: "missing_scope" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps Instagram container creation and publish distinct", async () => {
    const fetcher = fixtures({ id: "container" }, { id: "post" });
    const provider = instagram(fetcher as typeof fetch);
    expect(
      await provider.createContainer(tokens, "123", {
        imageUrl: "https://media.example/photo.jpg",
        caption: "Fixture",
      }),
    ).toEqual({ containerId: "container" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await provider.publishContainer(tokens, "123", "container")).toEqual({ postId: "post" });
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ creation_id: "container" });
  });
  it("honors creator privacy and sends explicit commercial and AI disclosure", async () => {
    const fetcher = fixtures(creator, { data: { publish_id: "pending" }, error: { code: "ok" } });
    expect(await tiktok(fetcher as typeof fetch).publishVideo(tokens, post)).toEqual({
      publishId: "pending",
    });
    const body = JSON.parse(fetcher.mock.calls[1]?.[1].body);
    expect(body.post_info).toMatchObject({
      privacy_level: "SELF_ONLY",
      brand_content_toggle: false,
      is_aigc: true,
    });
    expect(body.source_info).toEqual({ source: "PULL_FROM_URL", video_url: post.videoUrl });
  });
  it("returns the creator identity for the consent preview", async () => {
    expect(await tiktok(fixtures(creator) as typeof fetch).creatorInfo(tokens)).toMatchObject({
      creatorUsername: "fixture",
      creatorNickname: "Fixture Creator",
    });
  });
  it("rejects private third-party branded content before initialization", async () => {
    const fetcher = fixtures(creator);
    await expect(
      tiktok(fetcher as typeof fetch).publishVideo(tokens, { ...post, brandContent: true }),
    ).rejects.toMatchObject({ kind: "rejected" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects unsupported privacy before initializing publication", async () => {
    const fetcher = fixtures(creator);
    await expect(
      tiktok(fetcher as typeof fetch).publishVideo(tokens, {
        ...post,
        privacyLevel: "PUBLIC_TO_EVERYONE",
      }),
    ).rejects.toMatchObject({ kind: "rejected" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["network", "server", "malformed"])(
    "never retries an uncertain %s publish or leaks upstream credentials",
    async (mode) => {
      const fetcher = Object.assign(vi.fn(), { preconnect: vi.fn() });
      if (mode === "network") fetcher.mockRejectedValue(new Error("fixture-access fixture-secret"));
      else if (mode === "server")
        fetcher.mockResolvedValue(new Response("fixture-secret", { status: 503 }));
      else fetcher.mockResolvedValue(new Response("{}"));
      await expect(
        instagram(fetcher as typeof fetch).publishContainer(tokens, "123", "456"),
      ).rejects.toMatchObject({ kind: "uncertain", message: "Social provider request uncertain" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects provider-level errors returned with HTTP 200 without retaining their message", async () => {
    const provider = tiktok(
      fixtures({
        error: { code: "access_token_invalid", message: "fixture-secret" },
      }) as typeof fetch,
    );
    await expect(provider.account(tokens)).rejects.toMatchObject({
      kind: "rejected",
      message: "Social provider request rejected",
    });
  });
  it("reads Instagram permalink from the provider", async () => {
    const fetcher = fixtures({ permalink: "https://www.instagram.com/p/fixture/" });
    expect(await instagram(fetcher as typeof fetch).postUrl(tokens, "p")).toBe(
      "https://www.instagram.com/p/fixture/",
    );
    expect(fetcher.mock.calls[0]?.[0]).toContain("/p?fields=permalink");
  });
  it("reads the matching TikTok share URL without constructing one", async () => {
    const fetcher = fixtures({
      data: { videos: [{ id: "p", share_url: "https://www.tiktok.com/@fixture/video/123" }] },
      error: { code: "ok" },
    });
    expect(await tiktok(fetcher as typeof fetch).postUrl(tokens, "p")).toBe(
      "https://www.tiktok.com/@fixture/video/123",
    );
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ filters: { video_ids: ["p"] } });
  });
  it.each([
    undefined,
    "javascript:alert(1)",
    "https://instagram.com.attacker.test/p/a",
    "http://www.instagram.com/p/a",
    "https://secret@www.instagram.com/p/a",
  ])("does not expose absent or unsafe permalink %j", async (permalink) => {
    expect(
      await instagram(fixtures({ permalink }) as typeof fetch).postUrl(tokens, "p"),
    ).toBeNull();
  });
  it("does not use another video's share URL when the requested post is absent", async () => {
    expect(
      await tiktok(
        fixtures({
          data: {
            videos: [{ id: "other", share_url: "https://www.tiktok.com/@fixture/video/123" }],
          },
          error: { code: "ok" },
        }) as typeof fetch,
      ).postUrl(tokens, "p"),
    ).toBeNull();
  });
  it("reports absent metrics as null and preserves an observed zero", async () => {
    const provider = tiktok(
      fixtures({
        data: { videos: [{ id: "p", like_count: 0 }] },
        error: { code: "ok" },
      }) as typeof fetch,
    );
    expect(await provider.metrics(tokens, "p")).toEqual({
      views: null,
      likes: 0,
      comments: null,
      shares: null,
    });
  });
  it("does not equate TikTok acceptance with publication or invent a public id", async () => {
    const provider = tiktok(
      fixtures({
        data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] },
        error: { code: "ok" },
      }) as typeof fetch,
    );
    expect(await provider.status(tokens, "pending")).toEqual({ state: "published", postIds: [] });
  });
});

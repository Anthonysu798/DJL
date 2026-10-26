import {
  authenticated,
  expiresAt,
  form,
  metric,
  postUrl,
  record,
  request,
  requireScope,
  SocialProviderError,
  string,
  type AuthorizationInput,
  type ExchangeInput,
  type ProviderAccount,
  type ProviderMetrics,
  type ProviderOptions,
  type ProviderTokens,
  type SocialProvider,
} from "./types";
const ROOT = "https://open.tiktokapis.com/v2";
export interface TikTokPostInput {
  videoUrl: string;
  title: string;
  privacyLevel: string;
  disableDuet: boolean;
  disableStitch: boolean;
  disableComment: boolean;
  brandContent: boolean;
  brandOrganic: boolean;
  isAigc: boolean;
}
export class TikTokProvider implements SocialProvider {
  readonly id = "tiktok" as const;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(
    private readonly config: { clientKey: string; clientSecret: string },
    options: ProviderOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }
  authorizationUrl(input: AuthorizationInput): string {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({
      client_key: this.config.clientKey,
      response_type: "code",
      scope: "user.info.basic,video.publish,video.list",
      state: input.state,
      redirect_uri: input.redirectUri,
      ...(input.codeChallenge
        ? { code_challenge: input.codeChallenge, code_challenge_method: "S256" }
        : {}),
    }).toString();
    return url.toString();
  }
  private async token(values: Record<string, string>): Promise<ProviderTokens> {
    const body = await request(
      this.fetcher,
      `${ROOT}/oauth/token/`,
      form({
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        ...values,
      }),
    );
    return {
      accessToken: string(body.access_token),
      refreshToken: string(body.refresh_token),
      expiresAt: expiresAt(body.expires_in, this.now()),
      providerUserId: string(body.open_id),
      scope: string(body.scope)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  exchangeCode(input: ExchangeInput): Promise<ProviderTokens> {
    return this.token({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
    });
  }
  refresh(tokens: ProviderTokens): Promise<ProviderTokens> {
    if (!tokens.refreshToken) throw new SocialProviderError("rejected");
    return this.token({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  }
  async revoke(tokens: ProviderTokens): Promise<void> {
    await request(
      this.fetcher,
      `${ROOT}/oauth/revoke/`,
      form({
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        token: tokens.accessToken,
      }),
    );
  }
  async account(tokens: ProviderTokens): Promise<ProviderAccount> {
    requireScope(tokens, "user.info.basic");
    const body = await request(
      this.fetcher,
      `${ROOT}/user/info/?fields=open_id,display_name`,
      authenticated(tokens),
    );
    const user = record(record(body.data).user);
    return {
      id: string(user.open_id),
      username: "",
      displayName: string(user.display_name),
      scopes: tokens.scope,
      capabilities: {
        publish: tokens.scope.includes("video.publish"),
        metrics: tokens.scope.includes("video.list"),
      },
    };
  }
  async creatorInfo(tokens: ProviderTokens): Promise<{
    creatorUsername: string;
    creatorNickname: string;
    privacyLevels: string[];
    duetDisabled: boolean;
    stitchDisabled: boolean;
    commentDisabled: boolean;
    maxVideoDurationSeconds: number;
  }> {
    requireScope(tokens, "video.publish");
    const body = record(
      (
        await request(
          this.fetcher,
          `${ROOT}/post/publish/creator_info/query/`,
          authenticated(tokens, {}),
        )
      ).data,
    );
    if (
      !Array.isArray(body.privacy_level_options) ||
      typeof body.duet_disabled !== "boolean" ||
      typeof body.stitch_disabled !== "boolean" ||
      typeof body.comment_disabled !== "boolean" ||
      typeof body.max_video_post_duration_sec !== "number"
    )
      throw new SocialProviderError("invalid_response");
    return {
      creatorUsername: string(body.creator_username),
      creatorNickname: string(body.creator_nickname),
      privacyLevels: body.privacy_level_options.map(string),
      duetDisabled: body.duet_disabled,
      stitchDisabled: body.stitch_disabled,
      commentDisabled: body.comment_disabled,
      maxVideoDurationSeconds: body.max_video_post_duration_sec,
    };
  }
  async publishVideo(
    tokens: ProviderTokens,
    input: TikTokPostInput,
  ): Promise<{ publishId: string }> {
    requireScope(tokens, "video.publish");
    const creator = await this.creatorInfo(tokens);
    if (
      !creator.privacyLevels.includes(input.privacyLevel) ||
      (input.brandContent && input.privacyLevel === "SELF_ONLY") ||
      (creator.duetDisabled && !input.disableDuet) ||
      (creator.stitchDisabled && !input.disableStitch) ||
      (creator.commentDisabled && !input.disableComment)
    )
      throw new SocialProviderError("rejected");
    const body = await request(
      this.fetcher,
      `${ROOT}/post/publish/video/init/`,
      authenticated(tokens, {
        post_info: {
          title: input.title,
          privacy_level: input.privacyLevel,
          disable_duet: input.disableDuet,
          disable_stitch: input.disableStitch,
          disable_comment: input.disableComment,
          brand_content_toggle: input.brandContent,
          brand_organic_toggle: input.brandOrganic,
          is_aigc: input.isAigc,
        },
        source_info: { source: "PULL_FROM_URL", video_url: input.videoUrl },
      }),
      true,
    );
    try {
      return { publishId: string(record(body.data).publish_id) };
    } catch {
      throw new SocialProviderError("uncertain");
    }
  }
  async status(
    tokens: ProviderTokens,
    publishId: string,
  ): Promise<{ state: "processing" | "published" | "failed" | "unknown"; postIds: string[] }> {
    const data = record(
      (
        await request(
          this.fetcher,
          `${ROOT}/post/publish/status/fetch/`,
          authenticated(tokens, { publish_id: publishId }),
        )
      ).data,
    );
    const state =
      data.status === "PUBLISH_COMPLETE"
        ? "published"
        : data.status === "FAILED"
          ? "failed"
          : ["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD"].includes(String(data.status))
            ? "processing"
            : "unknown";
    // Numeric IDs can exceed JS safe integers; never manufacture an imprecise ID.
    const ids = Array.isArray(data.publicaly_available_post_id)
      ? data.publicaly_available_post_id.filter((id): id is string => typeof id === "string")
      : [];
    return { state, postIds: ids };
  }
  async postUrl(tokens: ProviderTokens, postId: string): Promise<string | null> {
    requireScope(tokens, "video.list");
    const data = record(
      (
        await request(
          this.fetcher,
          `${ROOT}/video/query/?fields=id,share_url`,
          authenticated(tokens, { filters: { video_ids: [postId] } }),
        )
      ).data,
    );
    const video = Array.isArray(data.videos)
      ? data.videos.map(record).find((video) => video.id === postId)
      : undefined;
    return postUrl(video?.share_url, "tiktok.com");
  }
  async metrics(tokens: ProviderTokens, postId: string): Promise<ProviderMetrics> {
    requireScope(tokens, "video.list");
    const data = record(
      (
        await request(
          this.fetcher,
          `${ROOT}/video/query/?fields=id,view_count,like_count,comment_count,share_count`,
          authenticated(tokens, { filters: { video_ids: [postId] } }),
        )
      ).data,
    );
    const video = Array.isArray(data.videos)
      ? data.videos.map(record).find((v) => v.id === postId)
      : undefined;
    return {
      views: metric(video?.view_count),
      likes: metric(video?.like_count),
      comments: metric(video?.comment_count),
      shares: metric(video?.share_count),
    };
  }
}

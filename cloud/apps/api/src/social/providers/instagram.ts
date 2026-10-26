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
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
];
export class InstagramProvider implements SocialProvider {
  readonly id = "instagram" as const;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly root: string;
  constructor(
    private readonly config: { clientId: string; clientSecret: string; graphVersion: string },
    options: ProviderOptions = {},
  ) {
    if (!/^v\d+\.\d+$/.test(config.graphVersion)) throw new SocialProviderError("rejected");
    this.root = `https://graph.instagram.com/${config.graphVersion}`;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }
  authorizationUrl(input: AuthorizationInput): string {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      scope: SCOPES.join(","),
      state: input.state,
      redirect_uri: input.redirectUri,
      enable_fb_login: "0",
      force_authentication: "1",
    }).toString();
    return url.toString();
  }
  async exchangeCode(input: ExchangeInput): Promise<ProviderTokens> {
    const body = await request(
      this.fetcher,
      "https://api.instagram.com/oauth/access_token",
      form({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
        code: input.code,
      }),
    );
    // Instagram Login responses may wrap the one authorized account in data.
    if (body.data !== undefined && (!Array.isArray(body.data) || body.data.length !== 1))
      throw new SocialProviderError("invalid_response");
    const grant = body.data === undefined ? body : record((body.data as unknown[])[0]);
    const short = string(grant.access_token);
    let grantedScopes: string[] | undefined;
    if (grant.permissions !== undefined) {
      if (typeof grant.permissions === "string") {
        grantedScopes = grant.permissions
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
      } else if (Array.isArray(grant.permissions)) {
        grantedScopes = grant.permissions.map(string);
      } else {
        throw new SocialProviderError("invalid_response");
      }
    }
    const url = new URL("https://graph.instagram.com/access_token");
    url.search = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: this.config.clientSecret,
      access_token: short,
    }).toString();
    const long = await request(this.fetcher, url, { method: "GET" });
    const tokens: ProviderTokens = {
      accessToken: string(long.access_token),
      expiresAt: expiresAt(long.expires_in, this.now()),
      scope: [],
    };
    // Requested permissions are never proof of consent. Missing grants need a permissions lookup.
    tokens.scope = grantedScopes ?? (await this.permissions(tokens));
    return tokens;
  }
  private async permissions(tokens: ProviderTokens): Promise<string[]> {
    const body = await request(this.fetcher, `${this.root}/me/permissions`, authenticated(tokens));
    if (!Array.isArray(body.data)) throw new SocialProviderError("invalid_response");
    return body.data
      .map(record)
      .filter((p) => p.status === "granted")
      .map((p) => string(p.permission));
  }
  async refresh(tokens: ProviderTokens): Promise<ProviderTokens> {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.search = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: tokens.accessToken,
    }).toString();
    const body = await request(this.fetcher, url, { method: "GET" });
    return {
      ...tokens,
      accessToken: string(body.access_token),
      expiresAt: expiresAt(body.expires_in, this.now()),
    };
  }
  async revoke(tokens: ProviderTokens): Promise<void> {
    const body = await request(this.fetcher, `${this.root}/me/permissions`, {
      ...authenticated(tokens),
      method: "DELETE",
    });
    if (body.success !== true) throw new SocialProviderError("invalid_response");
  }
  async account(tokens: ProviderTokens): Promise<ProviderAccount> {
    requireScope(tokens, "instagram_business_basic");
    const body = await request(
      this.fetcher,
      `${this.root}/me?fields=id,user_id,username,name,account_type`,
      authenticated(tokens),
    );
    const professional = body.account_type === "BUSINESS" || body.account_type === "MEDIA_CREATOR";
    return {
      id: string(body.user_id ?? body.id),
      username: string(body.username),
      displayName: typeof body.name === "string" ? body.name : string(body.username),
      scopes: tokens.scope,
      capabilities: {
        publish: professional && tokens.scope.includes("instagram_business_content_publish"),
        metrics: professional && tokens.scope.includes("instagram_business_manage_insights"),
      },
    };
  }
  async createContainer(
    tokens: ProviderTokens,
    accountId: string,
    input: { imageUrl: string; caption: string } | { videoUrl: string; caption: string },
  ): Promise<{ containerId: string }> {
    requireScope(tokens, "instagram_business_content_publish");
    const body = await request(
      this.fetcher,
      `${this.root}/${encodeURIComponent(accountId)}/media`,
      authenticated(
        tokens,
        "imageUrl" in input
          ? { image_url: input.imageUrl, caption: input.caption }
          : { video_url: input.videoUrl, caption: input.caption, media_type: "REELS" },
      ),
      true,
    );
    try {
      return { containerId: string(body.id) };
    } catch {
      throw new SocialProviderError("uncertain");
    }
  }
  async containerStatus(
    tokens: ProviderTokens,
    containerId: string,
  ): Promise<"ready" | "processing" | "published" | "failed" | "unknown"> {
    const body = await request(
      this.fetcher,
      `${this.root}/${encodeURIComponent(containerId)}?fields=status_code`,
      authenticated(tokens),
    );
    return body.status_code === "FINISHED"
      ? "ready"
      : body.status_code === "IN_PROGRESS"
        ? "processing"
        : body.status_code === "PUBLISHED"
          ? "published"
          : body.status_code === "ERROR" || body.status_code === "EXPIRED"
            ? "failed"
            : "unknown";
  }
  async publishContainer(
    tokens: ProviderTokens,
    accountId: string,
    containerId: string,
  ): Promise<{ postId: string }> {
    requireScope(tokens, "instagram_business_content_publish");
    const body = await request(
      this.fetcher,
      `${this.root}/${encodeURIComponent(accountId)}/media_publish`,
      authenticated(tokens, { creation_id: containerId }),
      true,
    );
    try {
      return { postId: string(body.id) };
    } catch {
      throw new SocialProviderError("uncertain");
    }
  }
  async postUrl(tokens: ProviderTokens, postId: string): Promise<string | null> {
    requireScope(tokens, "instagram_business_basic");
    const body = await request(
      this.fetcher,
      `${this.root}/${encodeURIComponent(postId)}?fields=permalink`,
      authenticated(tokens),
    );
    return postUrl(body.permalink, "instagram.com");
  }
  async metrics(tokens: ProviderTokens, postId: string): Promise<ProviderMetrics> {
    requireScope(tokens, "instagram_business_manage_insights");
    const body = await request(
      this.fetcher,
      `${this.root}/${encodeURIComponent(postId)}/insights?metric=views,likes,comments,shares`,
      authenticated(tokens),
    );
    if (!Array.isArray(body.data)) throw new SocialProviderError("invalid_response");
    const values = new Map(
      body.data
        .map(record)
        .map((row) => [
          row.name,
          Array.isArray(row.values) && row.values[0] ? record(row.values[0]).value : undefined,
        ]),
    );
    return {
      views: metric(values.get("views")),
      likes: metric(values.get("likes")),
      comments: metric(values.get("comments")),
      shares: metric(values.get("shares")),
    };
  }
}

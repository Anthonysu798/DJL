import { InstagramProvider } from "./instagram";
import { TikTokProvider } from "./tiktok";
import type { ProviderOptions, SocialProvider, SocialProviderId } from "./types";
export * from "./types";
export * from "./instagram";
export * from "./tiktok";
// Server-only factory. Absence means disabled; never supply fabricated credentials.
export function createSocialProviders(
  env: Record<string, string | undefined>,
  options: ProviderOptions = {},
): Partial<Record<SocialProviderId, SocialProvider>> {
  const providers: Partial<Record<SocialProviderId, SocialProvider>> = {};
  if (
    env.SOCIAL_INSTAGRAM_CLIENT_ID &&
    env.SOCIAL_INSTAGRAM_CLIENT_SECRET &&
    env.SOCIAL_INSTAGRAM_GRAPH_VERSION
  ) {
    providers.instagram = new InstagramProvider(
      {
        clientId: env.SOCIAL_INSTAGRAM_CLIENT_ID,
        clientSecret: env.SOCIAL_INSTAGRAM_CLIENT_SECRET,
        graphVersion: env.SOCIAL_INSTAGRAM_GRAPH_VERSION,
      },
      options,
    );
  }
  if (env.SOCIAL_TIKTOK_CLIENT_KEY && env.SOCIAL_TIKTOK_CLIENT_SECRET) {
    providers.tiktok = new TikTokProvider(
      { clientKey: env.SOCIAL_TIKTOK_CLIENT_KEY, clientSecret: env.SOCIAL_TIKTOK_CLIENT_SECRET },
      options,
    );
  }
  return providers;
}

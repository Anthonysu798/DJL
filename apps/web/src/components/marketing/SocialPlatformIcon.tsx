import { IconBrandInstagram, IconBrandTiktok, IconWorld } from "@tabler/icons-react";

/** Decorative marks always sit beside the platform's readable name. */
export function SocialPlatformIcon({ provider }: { provider: string }) {
  const Icon =
    provider === "instagram"
      ? IconBrandInstagram
      : provider === "tiktok" || provider === "douyin"
        ? IconBrandTiktok
        : IconWorld;
  return (
    <span className="publishing-platform-mark" data-provider={provider} aria-hidden="true">
      {provider === "red" ? (
        <span className="publishing-red-mark">小红书</span>
      ) : (
        <Icon size={17} stroke={1.7} />
      )}
    </span>
  );
}

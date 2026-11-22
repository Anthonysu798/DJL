import { useTranslation } from "react-i18next";
import type {
  MultiPostAccount,
  MultiPostCapability,
  MultiPostCommand,
  MultiPostKind,
} from "@djl/contracts";
export const kinds: MultiPostKind[] = ["dynamic", "article", "video", "podcast"];
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export type DraftInput = Extract<MultiPostCommand, { action: "save-draft" }>["draft"];
/** `friendly` replaces a technical failure with words the person can act on. */
export type CommandRunner = <T = unknown>(
  input: MultiPostCommand,
  friendly?: string,
) => Promise<T | undefined>;

export const multiPostViews = [
  "compose",
  "accounts",
  "queue",
  "authorizations",
  "resources",
] as const;
export type MultiPostView = (typeof multiPostViews)[number];

export function useMultiPostText() {
  const { t } = useTranslation("chat");
  return (key: string, fallback: string, values?: Record<string, unknown>) =>
    t(`multipost.${key}`, { defaultValue: fallback, ...values });
}
export const useMultiPostLocale = () => useTranslation("chat").i18n.language;
/** The upstream catalog spells a few brand names differently from how people know them. */
export const platformName = (platform: { platformKey: string; displayName: string }) =>
  ({ tiktok: "TikTok", rednote: "RedNote" })[platform.platformKey] ?? platform.displayName;
export const popularPlatforms = [
  "instagram",
  "tiktok",
  "x",
  "facebook",
  "youtube",
  "linkedin",
  "threads",
  "rednote",
  "douyin",
  "bilibili",
  "weibo",
  "pinterest",
];
/** Signed in, or on a platform where the person presses the final Publish button themselves. */
export function accountReady(account: MultiPostAccount, capabilities: MultiPostCapability[]) {
  return (
    account.status === "connected" ||
    (account.status === "needs-login" &&
      !capabilities.some((x) => x.platformKey === account.platformKey && x.identitySupported))
  );
}
export function autopilotOn(account: MultiPostAccount) {
  return Boolean(
    account.autopilot &&
    account.status === "connected" &&
    Date.parse(account.autopilot.expiresAt) > Date.now(),
  );
}

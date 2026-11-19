import { useId, useState, type ReactNode } from "react";
import {
  IconMessageCircle,
  IconMovie,
  IconScissors,
  IconFlag,
  IconUser,
  IconLink,
  IconSparkles,
} from "@tabler/icons-react";
import { Switch } from "~/components/ui/switch";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Campaign } from "@synara/contracts";
import type { CloudSocialCreatorInfo, CloudSocialDraftInput } from "@synara/contracts/cloud";
import { publishingCommand } from "./socialPublishingClient";

type Choices = {
  privacy: string;
  comment: boolean;
  duet: boolean;
  stitch: boolean;
  disclosure: boolean;
  ownBrand: boolean;
  thirdParty: boolean;
  music: boolean;
  ai: boolean;
};
export function TikTokPublishingOptions({
  campaign,
  version,
  accountId,
  disabled,
  onChange,
  initialOptions,
  mediaKind = "video",
}: {
  campaign: Campaign;
  version: number;
  accountId: string;
  disabled: boolean;
  mediaKind?: "image" | "video";
  initialOptions?: CloudSocialDraftInput["tiktokOptions"];
  onChange: (options: CloudSocialDraftInput["tiktokOptions"]) => void;
}) {
  const { t } = useTranslation("chat");
  const controlId = useId();
  const query = useQuery({
    queryKey: ["tiktok-creator", accountId, version],
    queryFn: () =>
      publishingCommand<CloudSocialCreatorInfo>(campaign, version, {
        action: "creator-info",
        accountId,
      }),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const [choices, setChoices] = useState<Choices>({
    privacy: initialOptions?.privacyLevel ?? "",
    comment: initialOptions ? !initialOptions.disableComment : false,
    duet: initialOptions ? !initialOptions.disableDuet : false,
    stitch: initialOptions ? !initialOptions.disableStitch : false,
    disclosure: Boolean(initialOptions?.brandOrganic || initialOptions?.brandContent),
    ownBrand: initialOptions?.brandOrganic ?? false,
    thirdParty: initialOptions?.brandContent ?? false,
    music: false,
    ai: initialOptions?.isAigc ?? false,
  });
  const info = query.data;
  function change(patch: Partial<Choices>) {
    const next = { ...choices, ...patch };
    setChoices(next);
    const branded = next.disclosure && next.thirdParty;
    if (
      !info ||
      !info.privacyLevels.includes(next.privacy) ||
      !next.music ||
      (next.disclosure && !next.ownBrand && !next.thirdParty) ||
      (branded && next.privacy === "SELF_ONLY")
    ) {
      onChange(undefined);
      return;
    }
    onChange({
      privacyLevel: next.privacy,
      disableComment: info.commentDisabled || !next.comment,
      disableDuet: mediaKind === "image" || info.duetDisabled || !next.duet,
      disableStitch: mediaKind === "image" || info.stitchDisabled || !next.stitch,
      brandOrganic: next.disclosure && next.ownBrand,
      brandContent: branded,
      isAigc: next.ai,
      musicUsageConfirmed: true,
    });
  }
  const toggle = (
    key: keyof Omit<Choices, "privacy" | "music">,
    label: string,
    icon: ReactNode,
    blocked = false,
  ) => (
    <label className="publishing-toggle-row gap-3">
      <span className="publishing-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span id={`${controlId}-${key}`} className="min-w-0 flex-1 text-sm">
        {label}
      </span>
      <Switch
        aria-labelledby={`${controlId}-${key}`}
        checked={!blocked && choices[key]}
        disabled={disabled || blocked}
        onCheckedChange={(checked) =>
          change({
            [key]: checked,
            ...(key === "disclosure" || key === "thirdParty" ? { music: false } : {}),
          })
        }
      />
    </label>
  );
  return (
    <fieldset
      disabled={disabled}
      className="mt-3 flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4"
    >
      <legend className="px-1 text-xs font-medium">TikTok</legend>
      {query.isPending && (
        <p role="status" className="text-xs">
          {t("social.creatorLoading", { defaultValue: "Loading current creator settings…" })}
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-xs text-destructive">
          {query.error.message}
        </p>
      )}
      {info && (
        <>
          <p className="text-sm font-medium">
            {info.nickname} (@{info.username})
          </p>
          {mediaKind === "video" && (
            <p className="text-xs text-muted-foreground">
              {t("social.videoLimit", {
                defaultValue: "Maximum video length: {{seconds}} seconds",
                seconds: info.maxVideoDurationSeconds,
              })}
            </p>
          )}
          <label className="block text-xs">
            {t("social.privacy", { defaultValue: "Who can see this post?" })}
            <select
              aria-label={t("social.privacy", { defaultValue: "Who can see this post?" })}
              className="mt-1 block w-full rounded border border-border bg-background p-2"
              value={choices.privacy}
              onChange={(event) => change({ privacy: event.target.value })}
            >
              <option value="" disabled>
                {t("social.choosePrivacy", { defaultValue: "Choose privacy" })}
              </option>
              {info.privacyLevels.map((level) => (
                <option
                  key={level}
                  value={level}
                  disabled={level === "SELF_ONLY" && choices.disclosure && choices.thirdParty}
                >
                  {(
                    {
                      PUBLIC_TO_EVERYONE: "Everyone",
                      MUTUAL_FOLLOW_FRIENDS: "Friends",
                      FOLLOWER_OF_CREATOR: "Followers",
                      SELF_ONLY: "Only me",
                    } as Record<string, string>
                  )[level] ?? level}
                </option>
              ))}
            </select>
          </label>
          {toggle(
            "comment",
            t("social.allowComments", { defaultValue: "Allow comments" }),
            <IconMessageCircle size={18} stroke={1.5} />,
            info.commentDisabled,
          )}
          {mediaKind === "video" && (
            <details className="publishing-content-details">
              <summary>
                {t("social.videoInteractions", { defaultValue: "Duet and Stitch settings" })}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {toggle(
                  "duet",
                  t("social.allowDuet", { defaultValue: "Allow Duet" }),
                  <IconMovie size={18} stroke={1.5} />,
                  info.duetDisabled,
                )}
                {toggle(
                  "stitch",
                  t("social.allowStitch", { defaultValue: "Allow Stitch" }),
                  <IconScissors size={18} stroke={1.5} />,
                  info.stitchDisabled,
                )}
              </div>
            </details>
          )}
          {toggle(
            "disclosure",
            t("social.disclose", {
              defaultValue: "This content promotes a brand, product or service",
            }),
            <IconFlag size={18} stroke={1.5} />,
          )}
          {choices.disclosure && (
            <div className="space-y-2 pl-4">
              {toggle(
                "ownBrand",
                t("social.ownBrand", { defaultValue: "Your brand" }),
                <IconUser size={18} stroke={1.5} />,
              )}
              {toggle(
                "thirdParty",
                t("social.thirdParty", { defaultValue: "Branded content for another business" }),
                <IconLink size={18} stroke={1.5} />,
                choices.privacy === "SELF_ONLY",
              )}
              {choices.privacy === "SELF_ONLY" && (
                <p className="text-xs text-muted-foreground">
                  {t("social.privateBrand", {
                    defaultValue: "Third-party branded content cannot be private.",
                  })}
                </p>
              )}
              {(choices.ownBrand || choices.thirdParty) && (
                <p className="text-xs">
                  {choices.thirdParty
                    ? t("social.paidLabel", {
                        defaultValue: "TikTok will apply a Paid partnership label.",
                      })
                    : t("social.promoLabel", {
                        defaultValue: "TikTok will apply a Promotional content label.",
                      })}
                </p>
              )}
            </div>
          )}
          {toggle(
            "ai",
            t("social.aiContent", { defaultValue: "This post contains AI-generated content" }),
            <IconSparkles size={18} stroke={1.5} />,
          )}
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-current"
              checked={choices.music}
              disabled={disabled}
              onChange={(event) => change({ music: event.target.checked })}
            />
            <span>
              {t("social.agreeTikTok", { defaultValue: "By posting, you agree to TikTok’s" })}{" "}
              {choices.disclosure && choices.thirdParty && (
                <>
                  <a
                    className="underline"
                    href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Branded Content Policy
                  </a>{" "}
                  and{" "}
                </>
              )}
              <a
                className="underline"
                href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                target="_blank"
                rel="noreferrer"
              >
                Music Usage Confirmation
              </a>
              .
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            {t("social.processingDelay", {
              defaultValue:
                "After publishing, TikTok may take a few minutes to process and display your post.",
            })}
          </p>
        </>
      )}
    </fieldset>
  );
}

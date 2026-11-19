import { useEffect, useId, useRef, useState } from "react";
import {
  IconCalendar,
  IconSend,
  IconCheck,
  IconExternalLink,
  IconShare3,
} from "@tabler/icons-react";
import "./publishing-review.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Campaign } from "@synara/contracts";
import type {
  CloudSocialDraft,
  CloudSocialMetricsResponse,
  CloudSocialDraftInput,
} from "@synara/contracts/cloud";
import { calendarTimeToIso, localCalendarTime } from "./socialCalendar";
import { SocialMediaCarousel } from "./SocialMediaCarousel";
import { SocialReviewShare } from "./SocialReviewShare";
import { SocialReportsCard } from "./SocialReportsCard";
import { SocialPlatformIcon } from "./SocialPlatformIcon";
import { TikTokPublishingOptions } from "./TikTokPublishingOptions";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { CopyIcon } from "~/lib/icons";
import {
  publishingCommand,
  publishingState,
  publishingMediaPreview,
  socialTaskDisplayState,
} from "./socialPublishingClient";

function showTime(draft: CloudSocialDraft) {
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: draft.content.timezone }).format(new Date(draft.content.scheduledAt))} · ${draft.content.timezone}`;
}

export function SocialPublishingCard({
  campaign,
  version,
  disabled = false,
  mediaKind = "video",
}: {
  campaign: Campaign;
  version: number;
  disabled?: boolean;
  mediaKind?: "image" | "video";
}) {
  const { t } = useTranslation("chat");
  const controlId = useId();
  const client = useQueryClient();
  const key = ["social-publishing", campaign.threadId, campaign.id, version];
  const query = useQuery({
    queryKey: key,
    queryFn: () => publishingState(campaign, version),
    refetchInterval: 5000,
    retry: false,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [publicationMode, setPublicationMode] = useState<"now" | "scheduled">("now");
  const [localTime, setLocalTime] = useState(() => {
    const date = new Date(Date.now() + 3600000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [photoCoverIndex, setPhotoCoverIndex] = useState(0);
  const [tiktokOptions, setTikTokOptions] =
    useState<CloudSocialDraftInput["tiktokOptions"]>(undefined);
  useEffect(() => {
    setTikTokOptions(undefined);
    setPhotoCoverIndex(0);
  }, [mediaKind, version]);
  const [editingDraft, setEditingDraft] = useState<{ draftId: string; revision: number } | null>(
    null,
  );
  const [savedTikTokOptions, setSavedTikTokOptions] =
    useState<CloudSocialDraftInput["tiktokOptions"]>(undefined);
  const [knownSchedule, setKnownSchedule] = useState<{ scheduledAt: string; timezone: string }>();
  function editDraft(draft: CloudSocialDraft) {
    setKnownSchedule({ scheduledAt: draft.content.scheduledAt, timezone: draft.content.timezone });
    setEditingDraft({ draftId: draft.id, revision: draft.revision });
    setPublicationMode(draft.content.publicationMode ?? "scheduled");
    setSelected([...draft.content.accountIds]);
    setTimezone(draft.content.timezone);
    setLocalTime(localCalendarTime(draft.content.scheduledAt, draft.content.timezone));
    setSavedTikTokOptions(draft.content.tiktokOptions);
    setPhotoCoverIndex(draft.content.tiktokOptions?.photoCoverIndex ?? 0);
    setTikTokOptions(undefined);
    setReview(null);
    setError("");
  }
  const [submitting, setBusy] = useState(false);
  const busy = submitting || disabled;
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ draft: CloudSocialDraft; version: number } | null>(null);
  const openedSavedReview = useRef(false);
  useEffect(() => {
    if (openedSavedReview.current || !query.data) return;
    const unconfirmed = query.data.drafts.filter(
      (draft) => !draft.confirmedAt && !draft.tasks.length,
    );
    if (unconfirmed.length !== 1) return;
    openedSavedReview.current = true;
    setReview({ draft: unconfirmed[0]!, version });
  }, [query.data, version]);
  const accounts = query.data?.accounts.accounts ?? [];
  const available = accounts.filter(
    (a) =>
      a.status === "connected" && a.capabilities.publish && campaign.platforms.includes(a.provider),
  );
  const tiktokId = selected.find((id) =>
    available.some((a) => a.id === id && a.provider === "tiktok"),
  );
  async function run(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await publishingCommand<CloudSocialDraft>(campaign, version, input);
      await client.invalidateQueries({
        queryKey: ["social-publishing", campaign.threadId, campaign.id],
      });
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publishing request failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    let date: Date;
    try {
      date =
        publicationMode === "scheduled"
          ? new Date(
              calendarTimeToIso(localTime, timezone, editingDraft ? knownSchedule : undefined),
            )
          : new Date();
      if (publicationMode === "scheduled" && date.getTime() <= Date.now())
        throw new Error("Choose a future publishing time.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Choose a valid publishing time.");
      return;
    }
    const draft = await run({
      action: "prepare",
      accountIds: selected,
      publicationMode,
      ...(publicationMode === "scheduled" ? { scheduledAt: date.toISOString() } : {}),
      timezone,
      ...(tiktokId
        ? {
            tiktokOptions: tiktokOptions && {
              ...tiktokOptions,
              ...(mediaKind === "image" && campaign.assetIds.length > 1
                ? {
                    photoCoverIndex: Math.min(
                      photoCoverIndex,
                      Math.max(campaign.assetIds.length - 1, 0),
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...editingDraft,
    });
    if (draft) {
      setReview({ draft, version });
      if (editingDraft) setEditingDraft({ draftId: draft.id, revision: draft.revision });
    }
  }
  const currentReview = review && review.version === version ? review.draft : null;
  const previewKey = currentReview
    ? `${currentReview.id}:${currentReview.revision}:${version}`
    : "";
  const [loadedPreview, setLoadedPreview] = useState("");
  const [failedPreview, setFailedPreview] = useState("");
  const [loadedPhotos, setLoadedPhotos] = useState<string[]>([]);
  const preview = useQuery({
    queryKey: ["social-media-preview", campaign.id, previewKey],
    queryFn: () =>
      publishingMediaPreview(campaign, version, currentReview!.id, currentReview!.revision),
    enabled: Boolean(currentReview),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const previewMedia =
    preview.data?.media ??
    (preview.data ? [{ url: preview.data.url, mimeType: preview.data.mimeType }] : []);
  const mediaCountMatches = previewMedia.length === currentReview?.content.mediaFileIds.length;
  const photoCarousel =
    previewMedia.length > 1 && previewMedia.every((item) => item.mimeType === "image/jpeg");
  const previewReady = Boolean(
    preview.data &&
    mediaCountMatches &&
    failedPreview !== previewKey &&
    (photoCarousel
      ? previewMedia.every((_, index) => loadedPhotos.includes(`${previewKey}:${index}`))
      : previewMedia.length === 1 && loadedPreview === previewKey),
  );
  const reviewAccountsReady =
    Boolean(currentReview?.content.accountIds.length) &&
    !query.error &&
    currentReview!.content.accountIds.every((id) => available.some((account) => account.id === id));
  const reviewTimeReady = Boolean(
    currentReview &&
    (currentReview.content.publicationMode === "now" ||
      Date.parse(currentReview.content.scheduledAt) > Date.now()),
  );
  const canConfirm = Boolean(
    currentReview &&
    !currentReview.confirmedAt &&
    !busy &&
    previewReady &&
    reviewAccountsReady &&
    reviewTimeReady,
  );
  async function confirmReview() {
    if (!currentReview) return;
    if (
      currentReview.content.publicationMode !== "now" &&
      Date.parse(currentReview.content.scheduledAt) <= Date.now()
    ) {
      setError("Choose a future publishing time and prepare the draft again.");
      return;
    }
    const result = await run({
      action: "confirm",
      draftId: currentReview.id,
      revision: currentReview.revision,
    });
    if (result) {
      setReview(null);
      setEditingDraft(null);
      setSavedTikTokOptions(undefined);
      setShowSetup(false);
    }
  }
  const name = (id: string) => {
    const a = accounts.find((a) => a.id === id);
    return a
      ? `${a.provider === "instagram" ? "Instagram" : "TikTok"} · ${a.displayName || a.username} (@${a.username})`
      : id;
  };
  const setupVisible = Boolean(
    editingDraft || showSetup || (!currentReview && !query.isPending && !query.data?.drafts.length),
  );
  const savedDrafts = (query.data?.drafts ?? [])
    .filter((draft) => draft.id !== currentReview?.id || draft.confirmedAt)
    .toSorted((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""));
  const visibleDrafts = savedDrafts.filter(
    (draft) =>
      showHistory ||
      !draft.confirmedAt ||
      draft.tasks.some((task) => !["published", "cancelled"].includes(task.state)),
  );
  const completedDraft =
    savedDrafts[0]?.confirmedAt &&
    savedDrafts[0].tasks.length &&
    savedDrafts[0].tasks.every((task) => ["published", "cancelled"].includes(task.state))
      ? savedDrafts[0]
      : null;
  const replacingSchedule =
    editingDraft &&
    query.data?.drafts
      .find((draft) => draft.id === editingDraft.draftId)
      ?.tasks.some((task) => task.state === "queued");

  return (
    <section
      aria-label={t("social.publishTitle", { defaultValue: "Publish from this chat" })}
      className="publishing-controls space-y-3"
    >
      {disabled && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("marketing.saveBeforeReview")}
        </p>
      )}
      {(currentReview ?? savedDrafts[0]) && (
        <details
          className="rounded-xl border border-border p-3"
          onToggle={(event) => setExtrasOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-xs">Feedback & weekly recap</summary>
          {extrasOpen && (
            <div className="mt-4 space-y-4">
              <SocialReviewShare
                key={`share:${(currentReview ?? savedDrafts[0])!.id}:${(currentReview ?? savedDrafts[0])!.revision}`}
                campaign={campaign}
                version={version}
                draft={(currentReview ?? savedDrafts[0])!}
                disabled={busy}
              />
              <SocialReportsCard
                key={`reports:${(currentReview ?? savedDrafts[0])!.id}`}
                campaign={campaign}
                version={version}
                draftId={(currentReview ?? savedDrafts[0])!.id}
                disabled={busy}
              />
            </div>
          )}
        </details>
      )}
      {(error || query.error) && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error || query.error?.message}
        </p>
      )}
      {query.isPending && (
        <p role="status" className="mt-2 text-xs">
          {t("social.loading", { defaultValue: "Loading publishing status…" })}
        </p>
      )}
      {!currentReview && Boolean(query.data?.drafts.length) && !editingDraft && (
        <label className="publishing-toggle-row">
          <span id={`${controlId}-new`}>{t("social.simple.newPost")}</span>
          <Switch
            aria-labelledby={`${controlId}-new`}
            checked={showSetup}
            disabled={busy}
            onCheckedChange={setShowSetup}
          />
        </label>
      )}
      {setupVisible && !currentReview && (
        <section className="publishing-setup" aria-label={t("social.simple.chooseAccounts")}>
          <h4 className="publishing-simple-label">{t("social.simple.chooseAccounts")}</h4>
          {available.map((a) => (
            <label
              key={a.id}
              className="publishing-account-choice"
              data-selected={selected.includes(a.id)}
            >
              <span className="publishing-account-avatar" aria-hidden="true">
                <SocialPlatformIcon provider={a.provider} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{a.displayName || a.username}</span>
                <span className="text-xs text-muted-foreground">
                  {a.provider === "instagram" ? "Instagram" : "TikTok"} · @{a.username}
                </span>
              </span>
              <Switch
                aria-labelledby={`${controlId}-${a.id}`}
                checked={selected.includes(a.id)}
                disabled={
                  busy || (a.provider === "tiktok" && Boolean(tiktokId) && tiktokId !== a.id)
                }
                onCheckedChange={(checked) => {
                  setSelected((ids) =>
                    checked ? [...ids, a.id] : ids.filter((id) => id !== a.id),
                  );
                  setReview(null);
                  if (a.provider === "tiktok") {
                    setTikTokOptions(undefined);
                    setSavedTikTokOptions(undefined);
                  }
                }}
              />
              <span id={`${controlId}-${a.id}`} className="sr-only">
                {name(a.id)}
              </span>
            </label>
          ))}
          {tiktokId && (
            <TikTokPublishingOptions
              key={`${tiktokId}:${mediaKind}:${version}:${editingDraft?.draftId ?? "new"}:${editingDraft?.revision ?? 0}`}
              mediaKind={mediaKind}
              initialOptions={savedTikTokOptions}
              campaign={campaign}
              version={version}
              accountId={tiktokId}
              disabled={busy}
              onChange={(options) => {
                setTikTokOptions(options);
                setReview(null);
              }}
            />
          )}
          {!query.isPending && !available.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("social.noPublishAccounts", {
                defaultValue: "Connect an account with publishing permission to continue.",
              })}
            </p>
          )}
          {editingDraft && (
            <div role="status" className="mt-3 rounded-lg bg-muted p-3 text-xs">
              <p>
                {t(replacingSchedule ? "social.simple.replaceNotice" : "social.simple.editNotice")}
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setEditingDraft(null);
                  setSavedTikTokOptions(undefined);
                  setTikTokOptions(undefined);
                  setReview(null);
                }}
              >
                {t("marketing.cancel")}
              </Button>
            </div>
          )}
          {tiktokId && mediaKind === "image" && campaign.assetIds.length > 1 && (
            <label className="mt-4 block text-xs">
              TikTok cover photo
              <select
                aria-label="TikTok cover photo"
                className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm"
                value={photoCoverIndex}
                disabled={busy}
                onChange={(event) => {
                  setPhotoCoverIndex(Number(event.target.value));
                  setReview(null);
                }}
              >
                {campaign.assetIds.map((id, index) => (
                  <option key={id} value={index}>
                    Photo {index + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="publishing-toggle-row">
            <span className="publishing-platform-name" id={`${controlId}-later`}>
              <IconCalendar size={18} aria-hidden="true" />
              {t("social.simple.later")}
            </span>
            <Switch
              aria-labelledby={`${controlId}-later`}
              checked={publicationMode === "scheduled"}
              disabled={busy}
              onCheckedChange={(checked) => {
                setPublicationMode(checked ? "scheduled" : "now");
                setReview(null);
              }}
            />
          </label>
          {publicationMode === "scheduled" && (
            <label className="mt-4 block text-xs">
              {t("social.publishTime", { defaultValue: "Publishing time" })} · {timezone}
              <input
                type="datetime-local"
                aria-label={t("social.publishTime", { defaultValue: "Publishing time" })}
                value={localTime}
                disabled={busy}
                onChange={(event) => {
                  setLocalTime(event.target.value);
                  setReview(null);
                }}
                className="mt-1 block max-w-full rounded-md border border-border bg-background p-2 text-sm"
              />
            </label>
          )}
          <Button
            className="publishing-prepare-button"
            variant="default"
            size="sm"
            disabled={
              busy ||
              !selected.length ||
              Boolean(tiktokId && !tiktokOptions) ||
              (publicationMode === "scheduled" && !localTime) ||
              selected.some((id) => !available.some((a) => a.id === id))
            }
            onClick={() => void prepare()}
          >
            <IconSend size={15} aria-hidden="true" />
            {t("social.simple.reviewPost")}
          </Button>
        </section>
      )}
      {currentReview && (
        <section aria-label="Final publishing review" className="publishing-final-review">
          <h4 className="publishing-review-question">{t("social.simple.ready")}</h4>
          <p className="text-xs">
            {currentReview.content.publicationMode === "now"
              ? t("social.publishNow")
              : showTime(currentReview)}
          </p>
          {currentReview.content.accountIds.map((id) => (
            <div key={id}>
              <p className="publishing-platform-name text-sm font-medium">
                <SocialPlatformIcon
                  provider={accounts.find((account) => account.id === id)?.provider ?? ""}
                />
                {name(id)}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">
                {currentReview.content.captions[id] ?? currentReview.content.caption}
              </p>
            </div>
          ))}
          <div className="space-y-2">
            {preview.isPending && (
              <p role="status" className="text-xs">
                {t("social.mediaLoading", { defaultValue: "Loading saved media…" })}
              </p>
            )}
            {(preview.error ||
              failedPreview === previewKey ||
              (preview.data &&
                (!mediaCountMatches ||
                  (previewMedia.length > 1 && !photoCarousel) ||
                  !["image/jpeg", "video/mp4"].includes(preview.data.mimeType)))) && (
              <p role="alert" className="text-xs text-destructive">
                {t("social.mediaPreviewFailed", {
                  defaultValue:
                    "The saved media preview could not load. Prepare the draft again before confirming.",
                })}
              </p>
            )}
            {photoCarousel && (
              <SocialMediaCarousel
                key={previewKey}
                media={previewMedia.map((item, index) => ({
                  id: `${previewKey}:${index}`,
                  url: item.url,
                  name: `Saved photo ${index + 1} of ${previewMedia.length}`,
                }))}
                onLoad={(id) =>
                  setLoadedPhotos((current) => (current.includes(id) ? current : [...current, id]))
                }
                onError={() => setFailedPreview(previewKey)}
              />
            )}
            {!photoCarousel && preview.data?.mimeType === "image/jpeg" && (
              <img
                key={previewKey}
                src={preview.data.url}
                alt={t("social.cloudMediaPreview", {
                  defaultValue: "Media saved for this publishing revision",
                })}
                className="publishing-saved-media"
                onLoad={() => {
                  setLoadedPreview(previewKey);
                  setFailedPreview("");
                }}
                onError={() => setFailedPreview(previewKey)}
              />
            )}
            {preview.data?.mimeType === "video/mp4" && (
              <video
                key={previewKey}
                src={preview.data.url}
                aria-label={t("social.cloudMediaPreview", {
                  defaultValue: "Media saved for this publishing revision",
                })}
                controls
                preload="auto"
                className="publishing-saved-media"
                onLoadedData={() => {
                  setLoadedPreview(previewKey);
                  setFailedPreview("");
                }}
                onError={() => setFailedPreview(previewKey)}
              />
            )}
          </div>
          {currentReview.content.tiktokOptions && (
            <div className="space-y-1 text-xs">
              <p>TikTok · {currentReview.content.tiktokOptions.privacyLevel}</p>
              <p>
                {t(
                  preview.data?.mimeType === "image/jpeg"
                    ? "social.reviewComments"
                    : "social.reviewInteractions",
                  {
                    defaultValue:
                      preview.data?.mimeType === "image/jpeg"
                        ? "Comments: {{comments}}"
                        : "Comments: {{comments}} · Duet: {{duet}} · Stitch: {{stitch}}",
                    comments: currentReview.content.tiktokOptions.disableComment ? "Off" : "On",
                    duet: currentReview.content.tiktokOptions.disableDuet ? "Off" : "On",
                    stitch: currentReview.content.tiktokOptions.disableStitch ? "Off" : "On",
                  },
                )}
              </p>
              <p>
                {currentReview.content.tiktokOptions.brandContent
                  ? "Paid partnership"
                  : currentReview.content.tiktokOptions.brandOrganic
                    ? "Promotional content"
                    : "No commercial disclosure"}
              </p>
              <p>
                {currentReview.content.tiktokOptions.isAigc
                  ? "AI-generated content label enabled"
                  : "AI-generated content label disabled"}
              </p>
              <p>
                {t("social.musicConfirmed", {
                  defaultValue: "Music usage agreement confirmed for this revision.",
                })}
              </p>
            </div>
          )}
          <div className="publishing-readiness" aria-label={t("social.readyChecklist")}>
            <p className="text-xs font-medium">
              {t(canConfirm ? "social.readyToConfirm" : "social.finishReview")}
            </p>
            <ul>
              {[
                ["accounts", reviewAccountsReady],
                ["media", previewReady],
                ["timing", reviewTimeReady],
              ]
                .filter(([, ready]) => !ready)
                .map(([check, ready]) => (
                  <li key={String(check)} data-ready={Boolean(ready)}>
                    <span aria-hidden="true">
                      {ready ? (
                        <IconCheck size={12} />
                      ) : (
                        <span className="publishing-check-pending" />
                      )}
                    </span>
                    <span>{t(`social.${ready ? "readiness" : "readinessPending"}.${check}`)}</span>
                  </li>
                ))}
            </ul>
          </div>
          <div className="publishing-action-bar">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => editDraft(currentReview)}
            >
              {t("social.editSaved", { defaultValue: "Edit content or time" })}
            </Button>
            <Button
              className="publishing-confirm-button"
              disabled={!canConfirm}
              onClick={() => void confirmReview()}
            >
              <IconSend size={15} aria-hidden="true" />
              {currentReview.content.publicationMode === "now"
                ? t("social.confirmNow")
                : t("social.confirmPublish", { defaultValue: "Confirm and schedule publication" })}
            </Button>
          </div>
        </section>
      )}
      {review && review.version !== version && (
        <p role="status" className="mt-3 text-xs">
          {t("social.staleReview", {
            defaultValue: "The campaign changed. Prepare a new review before confirming.",
          })}
        </p>
      )}
      {!currentReview && !setupVisible && !showHistory && completedDraft && (
        <div className="publishing-completed" aria-label={t("social.simple.activity")}>
          {completedDraft.tasks.map((task) => (
            <div key={task.id} className="publishing-completed-target">
              <p className="publishing-platform-name">
                <SocialPlatformIcon
                  provider={accounts.find((a) => a.id === task.accountId)?.provider ?? ""}
                />
                <span>
                  {accounts.find((a) => a.id === task.accountId)?.username
                    ? `@${accounts.find((a) => a.id === task.accountId)!.username}`
                    : name(task.accountId)}
                </span>
                <span className="publishing-status" data-state={task.state}>
                  {t(`social.task.${task.state}`)}
                </span>
              </p>
              {task.state === "published" && (
                <PublishedMetrics
                  campaign={campaign}
                  version={version}
                  taskId={task.id}
                  revision={task.revision}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {!currentReview && !setupVisible && savedDrafts.length > 0 && (
        <label className="publishing-toggle-row">
          <span id={`${controlId}-history`}>{t("social.simple.history")}</span>
          <Switch
            aria-labelledby={`${controlId}-history`}
            checked={showHistory}
            onCheckedChange={setShowHistory}
          />
        </label>
      )}
      {!currentReview &&
        !setupVisible &&
        visibleDrafts.map((draft) => (
          <details
            key={draft.id}
            open={
              draft.id === savedDrafts[0]?.id ||
              !draft.confirmedAt ||
              draft.tasks.some((task) =>
                ["failed", "uncertain"].includes(socialTaskDisplayState(task)),
              )
            }
            className="publishing-disclosure publishing-job"
          >
            <summary data-testid="publishing-draft-summary" className="publishing-schedule-summary">
              <span className="publishing-row-icon">
                <IconCalendar size={20} stroke={1.5} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {draft.content.publicationMode === "now"
                    ? t("social.publishNow")
                    : new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: draft.content.timezone,
                      }).format(new Date(draft.content.scheduledAt))}
                </span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {draft.content.timezone}
                </span>
              </span>
              <span className="flex flex-wrap justify-end gap-1.5">
                {draft.tasks.length ? (
                  [...new Set(draft.tasks.map((task) => socialTaskDisplayState(task)))].map(
                    (state) => (
                      <span key={state} className="publishing-status" data-state={state}>
                        {t(`social.task.${state}`, { defaultValue: state })}
                      </span>
                    ),
                  )
                ) : (
                  <span className="publishing-status">{t("marketing.draft")}</span>
                )}
              </span>
            </summary>
            <div className="space-y-2 pt-3">
              {!draft.tasks.some((task) =>
                ["publishing", "reconciling", "uncertain", "published"].includes(task.state),
              ) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => editDraft(draft)}
                >
                  {t("social.editSaved", { defaultValue: "Edit content or time" })}
                </Button>
              )}
              {!draft.confirmedAt && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setReview({ draft, version })}
                >
                  {t("social.reviewSaved", { defaultValue: "Review saved draft" })}
                </Button>
              )}
              {!draft.confirmedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("social.notConfirmed", {
                    defaultValue: "Draft saved; publication has not been authorized.",
                  })}
                </p>
              )}
              {draft.confirmedAt && (
                <>
                  {!draft.tasks.some((task) => task.state === "published") && (
                    <p className="text-xs text-muted-foreground">
                      {t("social.separateScheduled", {
                        defaultValue:
                          "This scheduled version is separate from your current draft. To apply edits, update the scheduled version and confirm again.",
                      })}
                    </p>
                  )}
                  <details className="publishing-content-details">
                    <summary>{t("social.simple.savedContent")}</summary>
                    {draft.content.accountIds.map((id) => (
                      <div key={id} className="text-xs">
                        <p className="publishing-platform-name font-medium">
                          <SocialPlatformIcon
                            provider={accounts.find((account) => account.id === id)?.provider ?? ""}
                          />
                          {name(id)}
                        </p>
                        <p className="whitespace-pre-wrap">
                          {draft.content.captions[id] ?? draft.content.caption}
                        </p>
                      </div>
                    ))}
                  </details>
                </>
              )}
              {draft.tasks.map((task) => (
                <div key={task.id} className="publishing-target-result text-xs">
                  <p className="publishing-platform-name">
                    <SocialPlatformIcon
                      provider={
                        accounts.find((account) => account.id === task.accountId)?.provider ?? ""
                      }
                    />
                    {name(task.accountId)} ·{" "}
                    {t(`social.task.${socialTaskDisplayState(task)}`, {
                      defaultValue: socialTaskDisplayState(task),
                    })}
                  </p>
                  {task.errorCode && socialTaskDisplayState(task) !== "publishing" && (
                    <p className="mt-1 text-destructive">{task.errorCode}</p>
                  )}
                  {socialTaskDisplayState(task) === "uncertain" && (
                    <p className="mt-1 text-muted-foreground">
                      {t("social.uncertain", {
                        defaultValue:
                          "The platform may have accepted this post. Check the account before taking further action; automatic retry is disabled.",
                      })}
                    </p>
                  )}
                  {task.state === "published" && (
                    <PublishedMetrics
                      campaign={campaign}
                      version={version}
                      taskId={task.id}
                      revision={task.revision}
                    />
                  )}
                  <div className="mt-2 flex gap-2">
                    {["queued", "failed"].includes(task.state) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run({
                            action: "task",
                            taskId: task.id,
                            revision: task.revision,
                            taskAction: "cancel",
                          })
                        }
                      >
                        {t("social.cancelTask", { defaultValue: "Cancel this target" })}
                      </Button>
                    )}
                    {task.state === "failed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run({
                            action: "task",
                            taskId: task.id,
                            revision: task.revision,
                            taskAction: "retry",
                          })
                        }
                      >
                        {t("social.retryTask", { defaultValue: "Retry this target" })}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
    </section>
  );
}

function PublishedMetrics({
  campaign,
  version,
  taskId,
  revision,
}: {
  campaign: Campaign;
  version: number;
  taskId: string;
  revision: number;
}) {
  const { t } = useTranslation("chat");
  const statsLabelId = useId();
  const [showStats, setShowStats] = useState(false);
  const query = useQuery({
    queryKey: ["social-metrics", taskId],
    queryFn: () =>
      publishingCommand<CloudSocialMetricsResponse>(campaign, version, {
        action: "metrics",
        taskId,
        revision,
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [shareError, setShareError] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: () => setShareError(t("social.copyFailed")),
  });
  let postUrl: string | null = null;
  if (query.data?.postUrl) {
    try {
      const url = new URL(query.data.postUrl);
      if (
        url.protocol === "https:" &&
        ["www.instagram.com", "instagram.com", "www.tiktok.com", "tiktok.com"].includes(
          url.hostname,
        ) &&
        !url.username &&
        !url.password
      )
        postUrl = url.href;
    } catch {
      /* Invalid upstream links are not clickable. */
    }
  }
  return (
    <div className="publishing-results space-y-3">
      {showStats && (
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.data
            ? t("social.refreshResults")
            : t("social.loadMetrics", { defaultValue: "Load post link and analytics" })}
        </Button>
      )}
      {query.isPending && (
        <p role="status" className="text-muted-foreground">
          {t("social.loadingResults")}
        </p>
      )}
      {shareError && (
        <p role="alert" className="text-destructive">
          {shareError}
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-destructive">
          {query.error.message}
        </p>
      )}
      {query.data && (
        <>
          {postUrl ? (
            <div className="publishing-share-actions">
              <a href={postUrl} target="_blank" rel="noopener noreferrer">
                <IconExternalLink size={16} aria-hidden="true" />
                {t("social.openPost", { defaultValue: "View published post" })}
              </a>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShareError("");
                  copyToClipboard(postUrl, undefined);
                }}
              >
                {isCopied ? (
                  <IconCheck size={15} />
                ) : (
                  <CopyIcon className="size-4" aria-hidden="true" />
                )}
                {t(isCopied ? "social.linkCopied" : "social.copyLink")}
              </Button>
              {typeof navigator.share === "function" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void navigator
                      .share({ url: postUrl, title: campaign.name })
                      .catch((error: unknown) => {
                        if (!(error instanceof DOMException && error.name === "AbortError"))
                          setShareError(t("social.shareFailed"));
                      });
                  }}
                >
                  <IconShare3 size={15} />
                  {t("social.sharePost")}
                </Button>
              )}
            </div>
          ) : (
            <p>{t("social.linkUnavailable", { defaultValue: "Post link unavailable" })}</p>
          )}
          <label className="publishing-toggle-row publishing-stats-toggle">
            <span id={statsLabelId}>{t("social.simple.stats")}</span>
            <Switch
              aria-labelledby={statsLabelId}
              checked={showStats}
              onCheckedChange={setShowStats}
            />
          </label>
          {showStats && (
            <>
              <dl className="publishing-metrics-grid">
                {(["views", "likes", "comments", "shares"] as const).map((metric) => (
                  <div key={metric}>
                    <dt>{t(`social.metric.${metric}`, { defaultValue: metric })}</dt>
                    <dd>
                      {query.data.metrics[metric] === null
                        ? t("social.unavailableMetric", { defaultValue: "Unavailable" })
                        : query.data.metrics[metric]}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">
                <time dateTime={new Date(query.dataUpdatedAt).toISOString()}>
                  {t("social.metricsRetrieved", {
                    time: new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(query.dataUpdatedAt)),
                  })}
                </time>
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

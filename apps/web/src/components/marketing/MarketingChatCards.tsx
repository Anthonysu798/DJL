import { MultiPostChatCard } from "../multipost/MultiPostChatCard";
import { CampaignPost } from "../multipost/CampaignPost";
import { alreadySent } from "../multipost/chatResult";
import { multiPostState } from "../multipost/client";
import { useEffect, useId, useRef, useState } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { CopyIcon } from "~/lib/icons";
import "./publishing-review.css";
import { SocialCampaignLink } from "./SocialCampaignLink";
import { SocialMediaCarousel, SocialMediaOrder } from "./SocialMediaCarousel";
import { SocialPlatformIcon } from "./SocialPlatformIcon";
import { SocialPublishingCard } from "./SocialPublishingCard";
import { publishingState, socialTaskDisplayState } from "./socialPublishingClient";
import { SocialConnectionCard } from "./SocialConnectionCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  IconCheck,
  IconBolt,
  IconDownload,
  IconExternalLink,
  IconUpload,
  IconUser,
} from "@tabler/icons-react";
import { platforms, type Campaign, type MediaAsset } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import {
  Dialog,
  DialogTrigger,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "~/components/ui/dialog";
import {
  command,
  loadThreadMarketing,
  mediaUrl,
  downloadPublishingKit,
  importMedia,
  type Stored,
} from "./client";

import { Link, useNavigate } from "@tanstack/react-router";
gsap.registerPlugin(useGSAP);

export function MarketingChatCards({
  threadId,
  isWorking,
  onPrompt,
}: {
  threadId: string;
  isWorking: boolean;
  onPrompt?: (text: string) => Promise<boolean>;
}) {
  const { t } = useTranslation("chat");
  const query = useQuery({
    queryKey: ["marketing-chat", threadId],
    queryFn: () => loadThreadMarketing(threadId),
    refetchInterval: isWorking ? 1500 : 10000,
    retry: false,
  });
  const navigate = useNavigate();
  const open = (multipostView: "accounts" | "queue") =>
    void navigate({
      to: "/social/$socialThreadId",
      params: { socialThreadId: threadId },
      search: { multipostView },
    });
  // Shares the chat card's poll: a preview that already went out needs no second card.
  const posts = useQuery({
    queryKey: ["multipost", threadId],
    queryFn: () => multiPostState(threadId),
    retry: false,
    refetchInterval: 3000,
  });
  const jobs = posts.data?.jobs.filter((job) => job.threadId === threadId) ?? [];
  return (
    <section
      aria-label="Marketing previews"
      className="mx-auto w-full max-w-3xl space-y-4 px-5 py-4"
    >
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/social/$socialThreadId" params={{ socialThreadId: threadId }} />}
        >
          <IconBolt size={15} aria-hidden="true" />
          {t("socialAgent.open", { defaultValue: "Social tools" })}
        </Button>
      </div>
      <MultiPostChatCard threadId={threadId} onSeeAll={() => open("queue")} />
      {query.data?.campaigns.map((c) => (
        <MarketingChatCard
          key={c.value.id}
          record={c}
          assets={query.data!.assets.map((a) => a.value)}
          threadId={threadId}
          isWorking={isWorking}
          sent={alreadySent(c.value.captions, jobs)}
          onAccounts={() => open("accounts")}
          {...(onPrompt ? { onPrompt } : {})}
        />
      ))}
    </section>
  );
}
export function MarketingChatCard({
  record,
  assets,
  threadId,
  isWorking,
  onPrompt,
  sent = false,
  onAccounts,
}: {
  record: Stored<Campaign>;
  assets: MediaAsset[];
  threadId: string;
  isWorking: boolean;
  onPrompt?: (text: string) => Promise<boolean>;
  /** Its caption already went out, so the chat shows the result line instead of this card. */
  sent?: boolean;
  onAccounts?: () => void;
}) {
  const { t } = useTranslation("chat");
  const client = useQueryClient();
  const campaign = record.value;
  const [platform, setPlatform] = useState(campaign.platforms[0] ?? "");
  const [editing, setEditing] = useState(false);
  const [showEditing, setShowEditing] = useState(false);
  const editLabelId = useId();
  const [reviewOpen, setReviewOpen] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  useGSAP(
    () => {
      if (!reviewOpen || !workspace.current) return;
      const motion = gsap.matchMedia();
      motion.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          "[data-publish-reveal]",
          { opacity: 0, y: 8, scale: 0.99 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.28,
            stagger: 0.045,
            ease: "power2.out",
            clearProps: "opacity,transform",
          },
        );
      });
      return () => motion.revert();
    },
    { scope: workspace, dependencies: [reviewOpen], revertOnUpdate: true },
  );
  const [copy, setCopy] = useState("");
  const [editVersion, setEditVersion] = useState(record.version);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [imageId, setImageId] = useState("");
  const destination = campaign.platforms.includes(platform)
    ? platform
    : (campaign.platforms[0] ?? "");
  const selectedAssets = campaign.assetIds.flatMap((id) => {
    const asset = assets.find((a) => a.id === id);
    return asset ? [asset] : [];
  });
  const photoMedia = selectedAssets.map((a) => ({
    id: a.id,
    url: mediaUrl(a.id, true),
    name: a.name,
  }));
  const preview = selectedAssets.find((a) => a.id === imageId) ?? selectedAssets[0];
  const provider = platforms.find((p) => p.id === destination);
  const approved = campaign.approvedRevision === campaign.revision;
  const publishing = useQuery({
    queryKey: ["social-publishing", campaign.threadId, campaign.id, record.version],
    queryFn: () => publishingState(campaign, record.version),
    enabled: Boolean(campaign.threadId),
    refetchInterval: 5000,
    retry: false,
  });
  const taskCounts = new Map<string, number>();
  for (const draft of publishing.data?.drafts ?? []) {
    for (const task of draft.tasks) {
      const state = socialTaskDisplayState(task);
      taskCounts.set(state, (taskCounts.get(state) ?? 0) + 1);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["marketing-chat", threadId] });
      await client.invalidateQueries({ queryKey: ["marketing"] });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("marketing.error"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: () => setError(t("social.copyFailed")),
  });
  async function replaceMedia(files: File[]) {
    const controller = new AbortController();
    upload.current = controller;
    await run(async () => {
      const limit = campaign.platforms.includes("instagram") ? 10 : 35;
      if (!files.length || files.length > limit)
        throw new Error(`Choose up to ${limit} photos, or one video.`);
      if (files.length > 1 && files.some((file) => !file.type.startsWith("image/")))
        throw new Error("Choose photos for a carousel, or one video on its own.");
      if (files.some((file) => file.size > 25 * 1024 * 1024))
        throw new Error(t("marketing.mediaLimit"));
      const imported = [];
      for (const file of files) imported.push(await importMedia(file, controller.signal));
      await command({
        action: "update",
        id: campaign.id,
        version: record.version,
        patch: { assetIds: imported.map((asset) => asset.value.id) },
      });
      setImageId(imported[0]!.value.id);
      setReview(false);
      setDownloaded(false);
    });
    upload.current = null;
  }
  const request = (text: string) =>
    void run(async () => {
      if (
        !onPrompt ||
        !(await onPrompt(
          `[${campaign.name.replaceAll("[", "").replaceAll("]", "").replaceAll("\\", "")}](/${encodeURIComponent(threadId)}#marketing-${campaign.id})\n\n${text}`,
        ))
      )
        throw new Error(t("marketing.sendFailed"));
    });
  return (
    <article
      className="overflow-hidden rounded-2xl border border-border bg-card text-foreground"
      data-testid="marketing-chat-card"
      id={`marketing-${campaign.id}`}
      hidden={sent && !reviewOpen}
    >
      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          setReviewOpen(open);
          if (!open && !editing) setShowEditing(false);
        }}
      >
        <div className="flex items-center gap-4 p-4">
          {preview && (
            <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
              {preview.mime.startsWith("image/") ? (
                <img
                  className="size-full object-contain"
                  alt=""
                  src={`${mediaUrl(preview.id, true)}${mediaUrl(preview.id, true).includes("?") ? "&" : "?"}revision=${campaign.revision}`}
                />
              ) : (
                <video
                  className="size-full object-cover"
                  muted
                  preload="metadata"
                  src={mediaUrl(preview.id)}
                />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              {campaign.platforms
                .map((id) => platforms.find((p) => p.id === id)?.name ?? id)
                .join(" · ")}
            </p>
            {taskCounts.size > 0 && (
              <p className="mt-1 text-xs" role="status">
                {t("socialAgent.publishingHistory")} ·{" "}
                {[...taskCounts]
                  .map(
                    ([state, count]) =>
                      `${t(`social.task.${state}`, { defaultValue: state })}${count > 1 ? ` · ${count}` : ""}`,
                  )
                  .join(" / ")}
              </p>
            )}
            <h3 className="mt-1 truncate text-sm font-semibold">{campaign.name}</h3>
            <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
              {campaign.captions[destination] || t("marketing.noCopy")}
            </p>
          </div>
          <DialogTrigger render={<Button size="sm" className="shrink-0" />}>
            {t("marketing.reviewPost")}
          </DialogTrigger>
        </div>
        <DialogPopup surface="solid" className="publishing-review-modal max-w-[540px]">
          <DialogHeader className="publishing-review-header">
            <div className="min-w-0">
              <DialogTitle>{t("social.simple.title")}</DialogTitle>
              <DialogDescription className="truncate">{campaign.name}</DialogDescription>
            </div>
          </DialogHeader>
          <DialogPanel>
            <div ref={workspace} className="publishing-workspace">
              <section className="publishing-composer" data-publish-reveal>
                <div className="publishing-section-heading">
                  <h4 className="publishing-platform-name">
                    {campaign.platforms.length === 1 ? (
                      <>
                        <SocialPlatformIcon provider={destination} />
                        {provider?.name ?? destination}
                      </>
                    ) : (
                      t("social.simple.yourPost")
                    )}
                  </h4>
                  <label className="publishing-toggle-label">
                    <span id={editLabelId}>{t("social.simple.editPost")}</span>
                    <Switch
                      aria-labelledby={editLabelId}
                      checked={showEditing}
                      disabled={editing || busy || isWorking}
                      onCheckedChange={setShowEditing}
                    />
                  </label>
                </div>
                <div className="pt-3">
                  {campaign.platforms.length > 1 && (
                    <div
                      className="publishing-platform-tabs"
                      role="tablist"
                      aria-label={t("marketing.platforms")}
                    >
                      {campaign.platforms.map((id) => (
                        <button
                          type="button"
                          key={id}
                          role="tab"
                          aria-selected={destination === id}
                          disabled={editing || busy}
                          onClick={() => setPlatform(id)}
                          className="publishing-platform-tab"
                        >
                          <SocialPlatformIcon provider={id} />
                          {platforms.find((p) => p.id === id)?.name ?? id}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedAssets.length > 1 &&
                  selectedAssets.every((a) => a.mime.startsWith("image/")) ? (
                    <SocialMediaCarousel key={campaign.assetIds.join(":")} media={photoMedia} />
                  ) : preview ? (
                    <div className="publishing-media-frame">
                      {preview.mime.startsWith("image/") ? (
                        <img
                          className="publishing-preview-image"
                          alt={preview.name}
                          src={`${mediaUrl(preview.id, true)}${mediaUrl(preview.id, true).includes("?") ? "&" : "?"}revision=${campaign.revision}`}
                        />
                      ) : (
                        <video
                          className="publishing-preview-image"
                          controls
                          src={mediaUrl(preview.id)}
                        />
                      )}
                    </div>
                  ) : (
                    <p className="mb-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                      {t("marketing.addMedia")}
                    </p>
                  )}
                  <div className="publishing-media-tools" hidden={!showEditing}>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*,video/mp4"
                      multiple
                      className="sr-only"
                      tabIndex={-1}
                      aria-label={t("marketing.replaceMedia")}
                      disabled={busy || editing || isWorking}
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.target.value = "";
                        if (files.length) void replaceMedia(files);
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || editing || isWorking}
                      onClick={() => fileInput.current?.click()}
                    >
                      <IconUpload size={15} />
                      {t("marketing.replaceMedia")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!campaign.captions[destination] || editing}
                      onClick={() =>
                        copyToClipboard(campaign.captions[destination] ?? "", undefined)
                      }
                    >
                      {isCopied ? (
                        <IconCheck size={15} />
                      ) : (
                        <CopyIcon className="size-4" aria-hidden="true" />
                      )}
                      {t(isCopied ? "marketing.captionCopied" : "marketing.copyCaption")}
                    </Button>
                  </div>
                  {showEditing &&
                    selectedAssets.length > 1 &&
                    selectedAssets.every((a) => a.mime.startsWith("image/")) && (
                      <SocialMediaOrder
                        media={photoMedia}
                        disabled={busy || editing || isWorking}
                        onChange={(ids) =>
                          void run(async () => {
                            await command({
                              action: "update",
                              id: campaign.id,
                              version: record.version,
                              patch: { assetIds: ids },
                            });
                            setReview(false);
                            setDownloaded(false);
                          })
                        }
                      />
                    )}
                  {showEditing && (
                    <SocialCampaignLink
                      key={`${campaign.id}:${record.version}:${destination}`}
                      campaign={campaign}
                      version={record.version}
                      platform={destination}
                      disabled={busy || editing || isWorking}
                      onApply={(url) =>
                        run(async () => {
                          const caption = campaign.captions[destination] ?? "";
                          if (caption.includes(url)) return;
                          await command({
                            action: "update",
                            id: campaign.id,
                            version: record.version,
                            patch: {
                              captions: {
                                ...campaign.captions,
                                [destination]: `${caption.trimEnd()}\n\n${url}`.trim(),
                              },
                            },
                          });
                          setReview(false);
                          setDownloaded(false);
                        })
                      }
                    />
                  )}
                  {editing ? (
                    <div>
                      <label className="block text-sm">
                        {t("marketing.caption")}
                        <textarea
                          aria-label={t("marketing.caption")}
                          disabled={busy}
                          rows={5}
                          maxLength={20000}
                          className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm"
                          value={copy}
                          onChange={(e) => setCopy(e.target.value)}
                        />
                      </label>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              command({
                                action: "update",
                                id: campaign.id,
                                version: editVersion,
                                patch: { captions: { ...campaign.captions, [destination]: copy } },
                              }),
                            ).then((ok) => {
                              if (ok) {
                                setEditing(false);
                                setReview(false);
                                setDownloaded(false);
                              }
                            })
                          }
                        >
                          {t("marketing.save")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setEditing(false)}
                        >
                          {t("marketing.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="publishing-caption-preview">
                      {campaign.captions[destination] || t("marketing.noCopy")}
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <div className="publishing-copy-tools" hidden={!showEditing}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || editing || isWorking || !destination}
                      onClick={() => {
                        setCopy(campaign.captions[destination] ?? "");
                        setEditVersion(record.version);
                        setEditing(true);
                      }}
                    >
                      {t("marketing.edit")}
                    </Button>
                    {onPrompt && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || editing || isWorking}
                          onClick={() => request(t("marketing.shorterPrompt"))}
                        >
                          {t("marketing.shorter")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || editing || isWorking}
                          onClick={() => request(t("marketing.premiumPrompt"))}
                        >
                          {t("marketing.premium")}
                        </Button>
                      </>
                    )}
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        busy ||
                        editing ||
                        isWorking ||
                        !selectedAssets.length ||
                        !campaign.platforms.length
                      }
                      onClick={() => setReview(!review)}
                    >
                      {t("marketing.review")}
                    </Button>
                  </div>
                </div>
                {review && (
                  <section
                    className="mt-4 rounded-xl border border-border bg-background p-4"
                    aria-label={t("marketing.review")}
                  >
                    <h4 className="text-sm font-semibold">{t("marketing.finalCheck")}</h4>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      {t("marketing.assisted")}
                    </p>
                    <p className="my-3 text-xs">
                      {campaign.platforms
                        .map((id) => platforms.find((p) => p.id === id)?.name)
                        .join(" · ")}
                    </p>
                    <Button
                      disabled={busy || editing || isWorking}
                      onClick={() =>
                        void run(async () => {
                          if (!approved)
                            await command({
                              action: "approve",
                              id: campaign.id,
                              version: record.version,
                            });
                          await downloadPublishingKit(campaign.id, campaign.revision);
                          setDownloaded(true);
                        })
                      }
                    >
                      <IconDownload size={15} />
                      {t("marketing.approveDownload")}
                    </Button>
                    {downloaded && approved && (
                      <p role="status" className="mt-3 text-xs text-muted-foreground">
                        {t("marketing.downloaded")}
                      </p>
                    )}
                    {approved && provider && (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <a
                          href={provider.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs underline"
                        >
                          {t("marketing.openPlatform", { platform: provider.name })}
                          <IconExternalLink size={13} />
                        </a>
                        {campaign.publications[destination]?.revision === campaign.revision ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <IconCheck size={13} />
                            {t("marketing.manualConfirmed")}
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                command({
                                  action: "confirm",
                                  id: campaign.id,
                                  version: record.version,
                                  platform: destination,
                                }),
                              )
                            }
                          >
                            {t("marketing.iPosted")}
                          </Button>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </section>
              <aside className="publishing-destinations" data-publish-reveal>
                <CampaignPost
                  threadId={threadId}
                  campaignId={campaign.id}
                  version={record.version}
                  platforms={campaign.platforms}
                  disabled={editing || busy || isWorking}
                  onPosted={() => setReviewOpen(false)}
                  onAccounts={onAccounts}
                />
                {/* Posts made through DJL Cloud before local posting keep their history here. */}
                {campaign.threadId && Boolean(publishing.data?.drafts.length) && (
                  <details className="publishing-disclosure publishing-accounts mt-4">
                    <summary>
                      <span className="publishing-row-icon">
                        <IconUser size={19} stroke={1.5} aria-hidden="true" />
                      </span>
                      <span className="flex-1">{t("socialAgent.publishingHistory")}</span>
                    </summary>
                    <SocialPublishingCard
                      mediaKind={selectedAssets[0]?.mime.startsWith("image/") ? "image" : "video"}
                      campaign={campaign}
                      version={record.version}
                      disabled={editing || busy || isWorking}
                    />
                    <SocialConnectionCard campaign={campaign} version={record.version} />
                  </details>
                )}
              </aside>
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </article>
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { IconCheck, IconDownload, IconExternalLink, IconSparkles } from "@tabler/icons-react";
import { platforms, type Campaign, type MediaAsset } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import {
  command,
  loadThreadMarketing,
  mediaUrl,
  downloadPublishingKit,
  type Stored,
} from "./client";

export function MarketingChatCards({
  threadId,
  isWorking,
  onPrompt,
}: {
  threadId: string;
  isWorking: boolean;
  onPrompt?: (text: string) => Promise<boolean>;
}) {
  const query = useQuery({
    queryKey: ["marketing-chat", threadId],
    queryFn: () => loadThreadMarketing(threadId),
    refetchInterval: isWorking ? 1500 : 10000,
    retry: false,
  });
  if (!query.data?.campaigns.length) return null;
  return (
    <section
      aria-label="Marketing previews"
      className="mx-auto w-full max-w-3xl space-y-4 px-5 py-4"
    >
      {query.data.campaigns.map((c) => (
        <MarketingChatCard
          key={c.value.id}
          record={c}
          assets={query.data!.assets.map((a) => a.value)}
          threadId={threadId}
          isWorking={isWorking}
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
}: {
  record: Stored<Campaign>;
  assets: MediaAsset[];
  threadId: string;
  isWorking: boolean;
  onPrompt?: (text: string) => Promise<boolean>;
}) {
  const { t } = useTranslation("chat");
  const client = useQueryClient();
  const campaign = record.value;
  const [platform, setPlatform] = useState(campaign.platforms[0] ?? "");
  const [editing, setEditing] = useState(false);
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
  const selectedAssets = assets.filter((a) => campaign.assetIds.includes(a.id));
  const preview = selectedAssets.find((a) => a.id === imageId) ?? selectedAssets[0];
  const provider = platforms.find((p) => p.id === destination);
  const approved = campaign.approvedRevision === campaign.revision;
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
    >
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="rounded-lg bg-accent p-2">
          <IconSparkles size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{t("marketing.ready")}</p>
          <h3 className="mt-1 truncate text-base font-semibold">{campaign.name}</h3>
        </div>
        <span className="text-xs text-muted-foreground">{t("marketing.draft")}</span>
      </header>
      <div className="p-5">
        <div
          className="mb-4 flex flex-wrap gap-2"
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
              className={`rounded-full border px-3 py-1.5 text-xs ${id === destination ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}
            >
              {platforms.find((p) => p.id === id)?.name ?? id}
            </button>
          ))}
        </div>
        {preview ? (
          <div className="mb-4 overflow-hidden rounded-xl bg-muted">
            {preview.mime.startsWith("image/") ? (
              <img
                className="max-h-96 w-full object-contain"
                alt={preview.name}
                src={`${mediaUrl(preview.id, true)}${mediaUrl(preview.id, true).includes("?") ? "&" : "?"}revision=${campaign.revision}`}
              />
            ) : (
              <video className="max-h-96 w-full" controls src={mediaUrl(preview.id)} />
            )}
          </div>
        ) : (
          <p className="mb-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            {t("marketing.addMedia")}
          </p>
        )}
        {selectedAssets.length > 1 && (
          <div className="mb-4 flex gap-2 overflow-auto">
            {selectedAssets.map((a) => (
              <button
                type="button"
                key={a.id}
                aria-label={a.name}
                onClick={() => setImageId(a.id)}
                className="h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border"
              >
                {a.mime.startsWith("image/") ? (
                  <img src={mediaUrl(a.id)} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-[10px]">{t("marketing.video")}</span>
                )}
              </button>
            ))}
          </div>
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
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                {t("marketing.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {campaign.captions[destination] || t("marketing.noCopy")}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
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
            size="sm"
            disabled={
              busy || editing || isWorking || !selectedAssets.length || !campaign.platforms.length
            }
            onClick={() => setReview(!review)}
          >
            {t("marketing.review")}
          </Button>
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
              {campaign.platforms.map((id) => platforms.find((p) => p.id === id)?.name).join(" · ")}
            </p>
            <Button
              disabled={busy || editing || isWorking}
              onClick={() =>
                void run(async () => {
                  if (!approved)
                    await command({ action: "approve", id: campaign.id, version: record.version });
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
      </div>
    </article>
  );
}

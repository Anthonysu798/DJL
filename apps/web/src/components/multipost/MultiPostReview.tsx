import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  MultiPostDraft,
  MultiPostAccount,
  MultiPostFile,
  MultiPostContentData,
} from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { multiPostCommand, mediaPreviewUrl } from "./client";
import { PlatformMark } from "./PlatformMark";
import "./multipost.css";
export function MultiPostReview({
  threadId,
  draft,
  accounts,
  onUpdated,
  onEdit,
}: {
  threadId: string;
  draft: MultiPostDraft;
  accounts: MultiPostAccount[];
  onUpdated: () => void;
  onEdit?: () => void;
}) {
  const { t } = useTranslation("chat");
  const label = (key: string, fallback: string) =>
    t(`multipost.${key}`, { defaultValue: fallback });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const files: MultiPostFile[] = [
    ...(draft.data.images ?? []),
    ...(draft.data.videos ?? []),
    ...draft.targets.flatMap((target) => [
      ...(target.overrides?.images ?? []),
      ...(target.overrides?.videos ?? []),
      ...[
        target.overrides?.video,
        target.overrides?.audio,
        target.overrides?.cover,
        target.overrides?.verticalCover,
        target.overrides?.horizontalCover,
      ].filter((file): file is MultiPostFile => Boolean(file)),
    ]),
    ...[
      draft.data.video,
      draft.data.audio,
      draft.data.cover,
      draft.data.horizontalCover,
      draft.data.verticalCover,
    ].filter((x): x is MultiPostFile => Boolean(x)),
  ];
  const contentDetails = (data: Partial<MultiPostContentData>) => (
    <div className="mp-muted">
      {data.digest && (
        <p>
          {label("excerpt", "Excerpt")}: {data.digest}
        </p>
      )}
      {data.tags?.length ? <p>{data.tags.map((tag) => `#${tag}`).join(" ")}</p> : null}
      {data.category !== undefined && (
        <p>
          {label("category", "Category")}: {data.category}
        </p>
      )}
      {data.collectionId !== undefined && (
        <p>
          {label("collection", "Collection / series")}: {data.collectionId}
        </p>
      )}
      {data.wordFileData && <p>{data.wordFileData.name}</p>}
      {typeof data.original === "boolean" && (
        <label>
          <input type="checkbox" checked={data.original} disabled readOnly />{" "}
          {label("original", "Original content")}
        </label>
      )}
      {typeof data.allowComment === "boolean" && (
        <label>
          <input type="checkbox" checked={data.allowComment} disabled readOnly />{" "}
          {label("allowComments", "Allow comments")}
        </label>
      )}
    </div>
  );
  const done = (url: string) => setLoaded((old) => new Set([...old, url]));
  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      await multiPostCommand(threadId, {
        action: "approve-draft",
        draftId: draft.id,
        revision: draft.revision,
      });
      await multiPostCommand(threadId, {
        action: "submit-draft",
        draftId: draft.id,
        revision: draft.revision,
      });
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mp-review" aria-label={label("finalReview", "Final publishing review")}>
      <div className="mp-section-heading">
        <h3>{draft.data.title || label("readyToPost", "Ready to post")}</h3>
      </div>
      <p className="mp-caption">
        {draft.data.content ||
          draft.data.description ||
          draft.data.markdownContent ||
          draft.data.digest}
      </p>
      {draft.data.htmlContent && (
        <iframe
          title={label("articlePreview", "Article preview")}
          sandbox=""
          srcDoc={draft.data.htmlContent}
          className="mp-html-preview"
        />
      )}
      {contentDetails(draft.data)}
      <div className="mp-preview-media">
        {[...new Map(files.map((file) => [file.url, file])).values()].map((file) => {
          const url = mediaPreviewUrl(threadId, file.url);
          return file.type?.startsWith("video/") ? (
            <video
              key={file.url}
              controls
              src={url}
              onLoadedMetadata={() => done(file.url)}
              onError={() =>
                setError(label("mediaError", "Media could not load. Fix it before approving."))
              }
            />
          ) : file.type?.startsWith("audio/") ? (
            <audio
              key={file.url}
              controls
              src={url}
              onLoadedMetadata={() => done(file.url)}
              onError={() =>
                setError(label("mediaError", "Media could not load. Fix it before approving."))
              }
            />
          ) : (
            <img
              key={file.url}
              src={url}
              alt={file.name}
              onLoad={() => done(file.url)}
              onError={() =>
                setError(label("mediaError", "Media could not load. Fix it before approving."))
              }
            />
          );
        })}
      </div>
      <ul className="mp-target-summary">
        {draft.targets.map((target) => {
          const account = accounts.find((x) => x.id === target.accountId);
          return (
            <li key={`${target.accountId}-${target.adapterId}`}>
              <PlatformMark
                platformKey={account?.platformKey ?? ""}
                name={account?.label ?? target.adapterId}
              />
              <strong>{account?.label ?? target.accountId}</strong>
              <span>
                {account?.identity
                  ? `@${account.identity.username}`
                  : label("identityUnverified", "Identity needs verification")}
              </span>
              {target.overrides?.title && <p>{target.overrides.title}</p>}
              {target.overrides?.content !== undefined && <p>{target.overrides.content}</p>}
              {target.overrides?.description && <p>{target.overrides.description}</p>}
              {target.overrides?.markdownContent && (
                <p className="mp-caption">{target.overrides.markdownContent}</p>
              )}
              {target.overrides && contentDetails(target.overrides)}
              {target.overrides?.scheduledPublishTime && (
                <p>
                  {label("nativeSchedule", "Platform-native scheduled time")}:{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: draft.timezone,
                  }).format(new Date(target.overrides.scheduledPublishTime))}{" "}
                  · {draft.timezone}
                </p>
              )}
              {target.overrides?.htmlContent && (
                <iframe
                  title={`${account?.label ?? "Account"} article preview`}
                  sandbox=""
                  srcDoc={target.overrides.htmlContent}
                  className="mp-html-preview"
                />
              )}
              {target.extraConfig && (
                <div className="mp-destination-settings">
                  {Object.entries(target.extraConfig).map(([key, value]) => (
                    <p key={key}>
                      <strong>
                        {key === "urls" || key === "customInjectUrls"
                          ? label("destinations", "Destinations")
                          : key}
                      </strong>
                      : {Array.isArray(value) ? value.join(" · ") : String(value)}
                    </p>
                  ))}
                </div>
              )}
              {account?.homeUrl &&
                !target.extraConfig?.urls &&
                !target.extraConfig?.customInjectUrls && <p>{account.homeUrl}</p>}
            </li>
          );
        })}
      </ul>
      <p className="mp-muted">
        {draft.data.scheduledPublishTime
          ? `${label("nativeSchedule", "Platform-native scheduled time")}: ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: draft.timezone }).format(new Date(draft.data.scheduledPublishTime))} · ${draft.timezone}`
          : draft.publicationMode === "scheduled" && draft.scheduledAt
            ? `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: draft.timezone }).format(new Date(draft.scheduledAt))} · ${draft.timezone}`
            : label("goesRightAway", "Goes out right away")}
      </p>
      {error && (
        <p role="alert" className="mp-error">
          {error}
        </p>
      )}
      <div className="mp-actions">
        <Button
          onClick={() => void approve()}
          disabled={busy || files.some((file) => !loaded.has(file.url))}
        >
          {busy
            ? label("working", "Working…")
            : draft.publicationMode === "scheduled"
              ? label("schedulePost", "Schedule post")
              : label("postNow", "Post now")}
        </Button>
        {onEdit && (
          <Button variant="ghost" onClick={onEdit}>
            {label("edit", "Edit")}
          </Button>
        )}
      </div>
    </section>
  );
}

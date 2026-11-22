import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  MultiPostContentData,
  MultiPostDraft,
  MultiPostFile,
  MultiPostKind,
  MultiPostState,
  MultiPostTarget,
} from "@djl/contracts";
import { Button } from "~/components/ui/button";
import { calendarTimeToIso, localCalendarTime } from "../marketing/socialCalendar";
import { uploadMultiPostMedia } from "./client";
import { kinds, errorMessage, type DraftInput } from "./shared";
export default function Composer({
  threadId,
  state,
  initial,
  busy,
  onSave,
  onError,
}: {
  threadId: string;
  state: MultiPostState;
  initial: MultiPostDraft | null;
  busy: boolean;
  onSave: (draft: DraftInput) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation("chat");
  const l = (key: string, fallback: string) => t(`multipost.${key}`, { defaultValue: fallback });
  const [kind, setKind] = useState<MultiPostKind>(initial?.kind ?? "dynamic");
  const [data, setData] = useState<MultiPostContentData>(
    initial?.data ?? { title: "", content: "" },
  );
  const [targets, setTargets] = useState<MultiPostTarget[]>(initial?.targets ?? []);
  const [mode, setMode] = useState<"now" | "scheduled">(initial?.publicationMode ?? "now");
  const [tz, setTz] = useState(
    initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [date, setDate] = useState(
    initial?.scheduledAt ? localCalendarTime(initial.scheduledAt, initial.timezone) : "",
  );
  const [uploading, setUploading] = useState(false);
  const [workflow, setWorkflow] = useState(initial?.workflowId ?? "");
  const set = (key: keyof MultiPostContentData, value: unknown) =>
    setData((old) => ({ ...old, [key]: value }));
  const upload = async (
    key: keyof MultiPostContentData,
    files: FileList | null,
    multiple: boolean,
  ) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        [...files].map((file) => uploadMultiPostMedia(threadId, file)),
      );
      set(
        key,
        multiple
          ? [...(Array.isArray(data[key]) ? (data[key] as MultiPostFile[]) : []), ...uploaded]
          : uploaded[0],
      );
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  const media = (
    key: keyof MultiPostContentData,
    title: string,
    accept: string,
    multiple = false,
  ) => (
    <label className="mp-field" key={key}>
      <span>{title}</span>
      <input
        aria-label={title}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={uploading}
        onChange={(event) => void upload(key, event.target.files, multiple)}
      />
      {data[key] && (
        <small>
          {(Array.isArray(data[key])
            ? (data[key] as MultiPostFile[])
            : [data[key] as MultiPostFile]
          )
            .map((file) => file.name)
            .join(", ")}{" "}
          <button type="button" onClick={() => set(key, multiple ? [] : undefined)}>
            {l("remove", "Remove")}
          </button>
        </small>
      )}
    </label>
  );
  const save = async () => {
    try {
      const saved = state.workflows.find((x) => x.id === workflow);
      await onSave({
        ...(initial ? { id: initial.id, revision: initial.revision } : {}),
        kind,
        data,
        replaceContent: true,
        targets,
        publicationMode: mode,
        scheduledAt: mode === "scheduled" ? calendarTimeToIso(date, tz) : null,
        timezone: tz,
        ...(saved ? { workflowId: saved.id, workflowRevision: saved.revision } : {}),
      });
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  return (
    <section className="mp-panel">
      <div className="mp-section-heading">
        <h2>{initial ? l("editDraft", "Edit draft") : l("compose", "Compose")}</h2>
        <span className="mp-muted">{l("localDraft", "Local draft")}</span>
      </div>
      <div className="mp-formats" role="group" aria-label={l("format", "Content format")}>
        {kinds.map((value) => (
          <button
            key={value}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setTargets([]);
            }}
          >
            {l(
              value,
              { dynamic: "Post", article: "Article", video: "Video", podcast: "Podcast" }[value],
            )}
          </button>
        ))}
      </div>
      <label className="mp-field">
        <span>{l("title", "Title")}</span>
        <input
          value={data.title}
          maxLength={500}
          onChange={(event) => set("title", event.target.value)}
        />
      </label>
      {kind === "article" ? (
        <>
          <label className="mp-field">
            <span>Markdown</span>
            <textarea
              rows={9}
              value={data.markdownContent ?? ""}
              onChange={(event) =>
                setData((old) => ({ ...old, markdownContent: event.target.value, htmlContent: "" }))
              }
            />
          </label>
          <details>
            <summary>{l("htmlContent", "HTML content and excerpt")}</summary>
            <label className="mp-field">
              <span>HTML</span>
              <textarea
                rows={6}
                value={data.htmlContent ?? ""}
                onChange={(event) =>
                  setData((old) => ({
                    ...old,
                    htmlContent: event.target.value,
                    markdownContent: "",
                  }))
                }
              />
            </label>
            <label className="mp-field">
              <span>{l("excerpt", "Excerpt")}</span>
              <textarea
                value={data.digest ?? ""}
                onChange={(event) => set("digest", event.target.value)}
              />
            </label>
          </details>
          {media("cover", l("cover", "Cover"), "image/*")}
          {media("wordFileData", l("wordFile", "Word document"), ".docx")}
        </>
      ) : (
        <label className="mp-field">
          <span>
            {kind === "podcast" ? l("description", "Description") : l("caption", "Caption")}
          </span>
          <textarea
            rows={8}
            value={(kind === "podcast" ? data.description : data.content) ?? ""}
            onChange={(event) =>
              set(kind === "podcast" ? "description" : "content", event.target.value)
            }
          />
        </label>
      )}
      {kind === "dynamic" && (
        <>
          {media("images", l("images", "Images"), "image/*", true)}
          {media("videos", l("videos", "Videos"), "video/*", true)}
        </>
      )}
      {kind === "video" && (
        <>
          {media("video", l("videoFile", "Video file"), "video/*")}
          {media("cover", l("cover", "Cover"), "image/*")}
          {media("verticalCover", l("verticalCover", "Vertical cover"), "image/*")}
          {media("horizontalCover", l("horizontalCover", "Horizontal cover"), "image/*")}
        </>
      )}
      {kind === "podcast" && (
        <>
          {media("audio", l("audioFile", "Audio file"), "audio/*")}
          {media("cover", l("cover", "Cover"), "image/*")}
        </>
      )}
      <label className="mp-field">
        <span>{l("tags", "Tags, separated by commas")}</span>
        <input
          value={data.tags?.join(", ") ?? ""}
          onChange={(event) =>
            set(
              "tags",
              event.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      <details>
        <summary>{l("platformOptions", "Platform options")}</summary>
        <label className="mp-field">
          <span>{l("category", "Category")}</span>
          <input
            value={data.category ?? ""}
            onChange={(event) => set("category", event.target.value)}
          />
        </label>
        <label className="mp-field">
          <span>{l("collection", "Collection / series")}</span>
          <input
            value={data.collectionId ?? ""}
            onChange={(event) => set("collectionId", event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={data.original ?? false}
            onChange={(event) => set("original", event.target.checked)}
          />{" "}
          {l("original", "Original content")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={data.allowComment ?? true}
            onChange={(event) => set("allowComment", event.target.checked)}
          />{" "}
          {l("allowComments", "Allow comments")}
        </label>
      </details>
      <h3>{l("destinations", "Destinations")}</h3>
      {!state.accounts.length && (
        <p className="mp-muted">
          {l("addAccountFirst", "Add an account from the Accounts tab to choose a destination.")}
        </p>
      )}
      {state.accounts.map((account) => {
        const adapter = state.capabilities.find(
          (x) => x.platformKey === account.platformKey && x.kind === kind,
        );
        if (!adapter) return null;
        const target = targets.find((x) => x.accountId === account.id);
        return (
          <div key={account.id} className="mp-destination">
            <label>
              <input
                type="checkbox"
                checked={Boolean(target)}
                onChange={(event) =>
                  setTargets((old) =>
                    event.target.checked
                      ? [...old, { accountId: account.id, adapterId: adapter.id }]
                      : old.filter((x) => x.accountId !== account.id),
                  )
                }
              />{" "}
              <strong>{account.label}</strong>{" "}
              <span className="mp-muted">{adapter.displayName}</span>
            </label>
            {target && (
              <details>
                <summary>{l("customize", "Customize this destination")}</summary>
                <label className="mp-field">
                  <span>{l("captionOverride", "Caption override")}</span>
                  <textarea
                    value={target.overrides?.content ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setTargets((old) =>
                        old.map((x) => {
                          if (x.accountId !== account.id) return x;
                          const overrides = { ...x.overrides };
                          if (value) overrides.content = value;
                          else delete overrides.content;
                          return { ...x, overrides };
                        }),
                      );
                    }}
                  />
                </label>
                <label className="mp-field">
                  <span>
                    {account.platformKey === "webhook"
                      ? l("webhookUrl", "Webhook URL")
                      : l("destinationUrl", "Custom publishing URL")}
                  </span>
                  <textarea
                    rows={2}
                    value={
                      (
                        (account.platformKey === "webhook"
                          ? target.extraConfig?.urls
                          : target.extraConfig?.customInjectUrls) as string[] | undefined
                      )?.join("\n") ?? ""
                    }
                    onChange={(event) =>
                      setTargets((old) =>
                        old.map((x) =>
                          x.accountId === account.id
                            ? {
                                ...x,
                                extraConfig: {
                                  ...x.extraConfig,
                                  [account.platformKey === "webhook" ? "urls" : "customInjectUrls"]:
                                    event.target.value
                                      ? event.target.value
                                          .split(/\r?\n/)
                                          .map((value) => value.trim())
                                          .filter(Boolean)
                                      : [],
                                },
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                {account.platformKey === "okjike" && (
                  <label className="mp-field">
                    <span>{l("topic", "Topic")}</span>
                    <input
                      value={String(target.extraConfig?.selectedTopic ?? "")}
                      onChange={(event) =>
                        setTargets((old) =>
                          old.map((x) =>
                            x.accountId === account.id
                              ? {
                                  ...x,
                                  extraConfig: {
                                    ...x.extraConfig,
                                    selectedTopic: event.target.value,
                                  },
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                )}
              </details>
            )}
          </div>
        );
      })}
      {(Boolean(data.scheduledPublishTime) ||
        (targets.length > 0 &&
          targets.every(
            (target) =>
              state.capabilities.find((cap) => cap.id === target.adapterId)
                ?.supportsNativeScheduling,
          ))) && (
        <label className="mp-field">
          <span>{l("nativeSchedule", "Platform-native scheduled time")}</span>
          <input
            type="datetime-local"
            value={
              data.scheduledPublishTime
                ? localCalendarTime(new Date(data.scheduledPublishTime), tz)
                : ""
            }
            onChange={(event) => {
              try {
                set(
                  "scheduledPublishTime",
                  event.target.value ? Date.parse(calendarTimeToIso(event.target.value, tz)) : 0,
                );
                if (event.target.value) setMode("now");
              } catch (error) {
                onError(errorMessage(error));
              }
            }}
          />
          <small>
            {l(
              "nativeScheduleHint",
              "DJL submits this schedule to the platform while running. The platform owns execution afterward.",
            )}
          </small>
        </label>
      )}
      <div className="mp-schedule">
        <label className="mp-field">
          <span>{l("timing", "When to publish")}</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "now" | "scheduled")}
          >
            <option value="now">{l("publishNow", "Publish now")}</option>
            <option value="scheduled">{l("scheduled", "Schedule")}</option>
          </select>
        </label>
        {mode === "scheduled" && (
          <label className="mp-field">
            <span>{l("dateTime", "Date and time")}</span>
            <input
              type="datetime-local"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        )}
        <label className="mp-field">
          <span>{l("timezone", "Timezone")}</span>
          <input value={tz} onChange={(event) => setTz(event.target.value)} />
        </label>
      </div>
      <label className="mp-field">
        <span>{l("workflow", "Workflow")}</span>
        <select value={workflow} onChange={(event) => setWorkflow(event.target.value)}>
          <option value="">{l("none", "None")}</option>
          {state.workflows.map((value) => (
            <option key={value.id} value={value.id}>
              {value.name} · {value.revision}
            </option>
          ))}
        </select>
      </label>
      <Button disabled={busy || uploading || !targets.length} onClick={() => void save()}>
        {uploading ? l("uploading", "Uploading…") : l("saveReview", "Save for review")}
      </Button>
    </section>
  );
}

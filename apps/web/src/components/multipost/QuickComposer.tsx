import { useRef, useState } from "react";
import { IconPhotoPlus, IconX } from "@tabler/icons-react";
import type { MultiPostFile, MultiPostQuickPostResult, MultiPostState } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { calendarTimeToIso } from "../marketing/socialCalendar";
import { mediaPreviewUrl, multiPostCommand, uploadMultiPostMedia } from "./client";
import { AccountChips, skippedText, WhenPicker } from "./PostControls";
import { captionWarnings } from "./postLook";
import { PostPreview } from "./PostPreview";
import { accountReady, errorMessage, platformName, useMultiPostText } from "./shared";

/** The whole job in one card: who to post to, what to say, when. */
export default function QuickComposer({
  threadId,
  state,
  onPosted,
  onSeeProgress,
  onAccounts,
}: {
  threadId: string;
  state: MultiPostState;
  onPosted: () => void;
  onSeeProgress: () => void;
  onAccounts: () => void;
}) {
  const l = useMultiPostText();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<MultiPostFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [later, setLater] = useState(false);
  const [date, setDate] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<(MultiPostQuickPostResult & { scheduled: boolean }) | null>(
    null,
  );
  const ready = state.accounts.filter((account) => accountReady(account, state.capabilities));
  const selected = ready.filter((account) => !left.has(account.id));
  const waiting = state.accounts.length - ready.length;
  const blocked = !selected.length
    ? l("pickAccount", "Pick at least one account.")
    : !text.trim() && !files.length
      ? l("writeSomething", "Write something or add a photo to post.")
      : later && !date
        ? l("pickTime", "Pick a date and time.")
        : "";

  const add = async (incoming: FileList | File[] | null) => {
    const list = [...(incoming ?? [])];
    if (!list.length) return;
    setError("");
    setUploading((count) => count + list.length);
    await Promise.all(
      list.map(async (file) => {
        try {
          const saved = await uploadMultiPostMedia(threadId, file);
          setFiles((old) => [...old, saved]);
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setUploading((count) => count - 1);
        }
      }),
    );
  };
  const post = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await multiPostCommand<MultiPostQuickPostResult>(threadId, {
        action: "quick-post",
        post: {
          text: text.trim(),
          media: files,
          accountIds: selected.map((account) => account.id),
          ...(later ? { scheduledAt: calendarTimeToIso(date, timezone) } : {}),
          timezone,
        },
      });
      setDone({ ...result, scheduled: later });
      onPosted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <section className="mp-card mp-done" aria-live="polite">
        <svg className="mp-done-check" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="21" />
          <path d="M15 24.5l6.5 6.5L33.5 18" />
        </svg>
        <h2>
          {done.scheduled ? l("scheduledDone", "Scheduled!") : l("postedDone", "On its way!")}
        </h2>
        <p className="mp-muted">
          {done.scheduled
            ? l("scheduledDoneHint", "Keep DJL open at that time and it will go out by itself.")
            : l("postedDoneHint", "DJL is posting it now. This usually takes under a minute.")}
        </p>
        {done.skipped?.map((item) => (
          <p className="mp-warn" key={item.accountId}>
            {l(skippedText[item.reason][0], skippedText[item.reason][1], { name: item.label })}
          </p>
        ))}
        <div className="mp-actions">
          <Button onClick={onSeeProgress}>{l("seeProgress", "See progress")}</Button>
          <Button
            variant="outline"
            onClick={() => {
              setDone(null);
              setText("");
              setFiles([]);
              setDate("");
              setLater(false);
            }}
          >
            {l("writeAnother", "Write another post")}
          </Button>
        </div>
      </section>
    );

  return (
    <section
      className="mp-card mp-quick"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void add(event.dataTransfer.files);
      }}
    >
      <div className="mp-step">
        <h2>{l("postTo", "Post to")}</h2>
        <AccountChips
          accounts={ready}
          selected={(account) => !left.has(account.id)}
          onToggle={(account, on) =>
            setLeft((old) => {
              const next = new Set(old);
              if (on) next.delete(account.id);
              else next.add(account.id);
              return next;
            })
          }
        >
          <button type="button" className="mp-chip mp-chip-add" onClick={onAccounts}>
            {waiting > 0
              ? l("finishSignIn", "{{n}} waiting for sign-in", { n: waiting })
              : l("addAnother", "+ Add account")}
          </button>
        </AccountChips>
      </div>
      <div className="mp-step">
        <textarea
          className="mp-quick-text"
          aria-label={l("yourPost", "Your post")}
          placeholder={l("yourPostPlaceholder", "What do you want to share?")}
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="mp-thumbs">
          {files.map((file) => (
            <figure className="mp-thumb" key={file.url}>
              {file.type?.startsWith("video/") ? (
                <video src={mediaPreviewUrl(threadId, file.url)} muted playsInline />
              ) : (
                <img src={mediaPreviewUrl(threadId, file.url)} alt={file.name} />
              )}
              <button
                type="button"
                aria-label={l("removeFile", "Remove {{name}}", { name: file.name })}
                onClick={() => setFiles((old) => old.filter((x) => x.url !== file.url))}
              >
                <IconX size={12} stroke={2.4} aria-hidden="true" />
              </button>
            </figure>
          ))}
          {Array.from({ length: uploading }, (_, index) => (
            <div className="mp-thumb mp-thumb-loading" key={index} role="status">
              <span className="sr-only">{l("uploading", "Uploading…")}</span>
            </div>
          ))}
          <button type="button" className="mp-add-media" onClick={() => picker.current?.click()}>
            <IconPhotoPlus size={18} stroke={1.7} aria-hidden="true" />
            <span>{l("addMedia", "Add photos or a video")}</span>
          </button>
          <input
            ref={picker}
            className="sr-only"
            type="file"
            multiple
            accept="image/*,video/*"
            aria-label={l("addMedia", "Add photos or a video")}
            onChange={(event) => {
              void add(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      <PostPreview
        threadId={threadId}
        text={text}
        files={files}
        accounts={selected}
        capabilities={state.capabilities}
        onFocus={(url, focus) =>
          setFiles((old) => old.map((file) => (file.url === url ? { ...file, focus } : file)))
        }
      />
      {captionWarnings(
        text,
        selected.map((account) => account.platformKey),
      ).map((warning) => {
        const platform = state.capabilities.find((x) => x.platformKey === warning.platformKey);
        const name = platform ? platformName(platform) : warning.platformKey;
        return (
          <p className="mp-warn" role="status" key={`${warning.platformKey}:${warning.kind}`}>
            {warning.kind === "too-long"
              ? l(
                  "warnTooLong",
                  "Too long for {{name}} by {{n}} characters. Shorten it, or {{name}} may cut it off.",
                  { name, n: warning.over },
                )
              : l(
                  "warnTooManyTags",
                  "{{name}} allows {{n}} hashtags. Remove a few so the post is not rejected.",
                  { name, n: warning.allowed },
                )}
          </p>
        );
      })}
      <WhenPicker
        later={later}
        date={date}
        timezone={timezone}
        onLater={setLater}
        onDate={setDate}
      />
      {error && (
        <p role="alert" className="mp-error">
          {error}
        </p>
      )}
      <div className="mp-quick-footer">
        <small className="mp-muted">{blocked}</small>
        <Button
          size="lg"
          className="mp-post"
          disabled={busy || uploading > 0 || Boolean(blocked)}
          onClick={() => void post()}
        >
          {busy
            ? l("working", "Working…")
            : later
              ? l("schedulePost", "Schedule post")
              : l("postNow", "Post now")}
        </Button>
      </div>
    </section>
  );
}

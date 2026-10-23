import { useDraft } from "./draft";
import { useUnsaved } from "./unsaved";
import { useRef, useState } from "react";
import {
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconScissors,
  IconTrash,
  IconDownload,
} from "@tabler/icons-react";
import type { MediaAsset } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import {
  mediaUrl,
  saveTimeline,
  downloadTimeline,
  type Stored,
  type VideoTimeline,
  type VideoClip,
} from "./client";
export function VideoStudio({
  campaignId,
  assets,
  saved,
  run,
  busy,
}: {
  campaignId: string;
  assets: MediaAsset[];
  saved?: Stored<VideoTimeline> | undefined;
  run: (label: string, op: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const videos = assets.filter((a) => a.mime.startsWith("video/"));
  const project = useDraft({
    value: {
      clips: saved?.value.clips ?? [],
      ratio: saved?.value.width === 1920 ? "landscape" : "portrait",
    },
    version: saved?.version ?? 0,
  });
  const clips = project.value.clips;
  const setClips = (next: VideoClip[] | ((value: VideoClip[]) => VideoClip[])) =>
    project.setValue((current) => ({
      ...current,
      clips: typeof next === "function" ? next(current.clips) : next,
    }));
  const [active, setActive] = useState(0);
  const ratio = project.value.ratio;
  const setRatio = (ratio: string) => project.setValue((current) => ({ ...current, ratio }));
  const [time, setTime] = useState(0);
  const player = useRef<HTMLVideoElement>(null);
  const clip = clips[active];
  const asset = videos.find((a) => a.id === clip?.assetId);
  const value: VideoTimeline = {
    campaignId,
    version: project.version,
    width: ratio === "portrait" ? 1080 : 1920,
    height: ratio === "portrait" ? 1920 : 1080,
    clips,
  };
  useUnsaved(project.dirty);
  const duration = clips.reduce((sum, c) => sum + (c.end - c.start) / c.speed, 0);
  function patch(change: Partial<VideoClip>) {
    setClips((list) => list.map((c, i) => (i === active ? { ...c, ...change } : c)));
  }
  function move(delta: number) {
    const to = active + delta;
    if (to < 0 || to >= clips.length) return;
    setClips((list) => {
      const next = [...list];
      [next[active], next[to]] = [next[to]!, next[active]!];
      return next;
    });
    setActive(to);
  }
  if (!campaignId)
    return (
      <div className="ms-empty">
        <h2>Select a campaign for your timeline.</h2>
        <p>Your saved timeline belongs to the campaign and can be reopened later.</p>
      </div>
    );
  return (
    <div>
      <div className="ms-editor">
        <div className="ms-preview-area">
          <div className="ms-preview-toolbar">
            <span>{asset?.name ?? "Video preview"}</span>
            <span>{duration.toFixed(1)} seconds total</span>
          </div>
          <div className="ms-canvas">
            {asset && clip ? (
              <video
                ref={player}
                key={`${active}-${asset.id}`}
                controls
                src={mediaUrl(asset.id)}
                onLoadedMetadata={() => {
                  if (player.current) player.current.currentTime = clip.start;
                }}
                onTimeUpdate={() => {
                  setTime(player.current?.currentTime ?? 0);
                  if (player.current && player.current.currentTime >= clip.end)
                    player.current.pause();
                }}
              />
            ) : (
              <p>Add a clip from the media bin.</p>
            )}
          </div>
          <div className="ms-preview-toolbar">
            <span>Source preview · {time.toFixed(2)}s</span>
            <span>Export applies trims, speed, and aspect ratio.</span>
          </div>
        </div>
        <aside className="ms-inspector">
          <h2>Clip settings</h2>
          {clip && (
            <>
              <label>
                Start (seconds)
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={clip.end}
                  value={clip.start}
                  onChange={(e) => patch({ start: Number(e.target.value) })}
                />
              </label>
              <label>
                End (seconds)
                <input
                  type="number"
                  step="0.1"
                  min={clip.start}
                  max={asset?.duration}
                  value={clip.end}
                  onChange={(e) => patch({ end: Number(e.target.value) })}
                />
              </label>
              <label>
                Speed
                <select
                  value={clip.speed}
                  onChange={(e) => patch({ speed: Number(e.target.value) })}
                >
                  {[0.5, 0.75, 1, 1.5, 2].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={time <= clip.start || time >= clip.end}
                onClick={() =>
                  setClips((list) =>
                    list.flatMap((c, i) =>
                      i === active
                        ? [
                            { ...c, end: time },
                            { ...c, start: time },
                          ]
                        : [c],
                    ),
                  )
                }
              >
                <IconScissors /> Split at playhead
              </Button>
              <div className="ms-actions">
                <Button
                  aria-label="Move clip earlier"
                  variant="outline"
                  disabled={active === 0}
                  onClick={() => move(-1)}
                >
                  <IconPlayerTrackPrev />
                </Button>
                <Button
                  aria-label="Move clip later"
                  variant="outline"
                  disabled={active === clips.length - 1}
                  onClick={() => move(1)}
                >
                  <IconPlayerTrackNext />
                </Button>
                <Button
                  aria-label="Remove clip"
                  variant="outline"
                  onClick={() => {
                    setClips((list) => list.filter((_, i) => i !== active));
                    setActive(0);
                  }}
                >
                  <IconTrash />
                </Button>
              </div>
            </>
          )}
          <label>
            Export format
            <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
              <option value="portrait">9:16 · 1080 × 1920</option>
              <option value="landscape">16:9 · 1920 × 1080</option>
            </select>
          </label>
          <p className="ms-muted">
            H.264 / AAC · 30 fps. Images are fitted with padding, never silently cropped. Source
            audio is preserved; silent clips remain silent.
          </p>
          <Button
            disabled={busy || !clips.length}
            onClick={() =>
              void run("Timeline saved", async () => {
                const result = await saveTimeline(value);
                project.accept({
                  value: { clips: result.value.clips, ratio },
                  version: result.version,
                });
              })
            }
          >
            Save timeline
          </Button>
          <Button
            variant="outline"
            disabled={busy || !clips.length}
            onClick={() => void run("Video export started", () => downloadTimeline(value))}
          >
            <IconDownload /> Export MP4
          </Button>
        </aside>
      </div>
      <div className="ms-timeline">
        <div className="ms-section-title">
          <h2>Timeline</h2>
          <span>{clips.length} clips</span>
        </div>
        <div className="ms-track">
          {clips.map((c, i) => (
            <button
              key={i}
              className={active === i ? "active" : ""}
              style={{ flexGrow: (c.end - c.start) / c.speed }}
              onClick={() => setActive(i)}
            >
              <strong>{videos.find((a) => a.id === c.assetId)?.name}</strong>
              <small>
                {c.start.toFixed(1)}–{c.end.toFixed(1)}s · {c.speed}×
              </small>
            </button>
          ))}
        </div>
      </div>
      <section className="ms-panel">
        <h2>Media bin</h2>
        <div className="ms-actions">
          {videos.map((v) => (
            <Button
              key={v.id}
              variant="outline"
              disabled={!v.duration || clips.length >= 32}
              onClick={() => {
                setClips((list) => [
                  ...list,
                  { assetId: v.id, start: 0, end: v.duration!, speed: 1 },
                ]);
                setActive(clips.length);
              }}
            >
              + {v.name}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}

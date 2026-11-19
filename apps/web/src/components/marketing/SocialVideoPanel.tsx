import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentVideoJob,
  AgentVideoSubtitle,
  AgentVideoTranscript,
  AgentVideoTranscribeResult,
  Campaign,
  MediaAsset,
} from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { agentCommand } from "./agentClient";
import { command, mediaUrl, type Stored } from "./client";
import { parseVideoSubtitles } from "./videoSubtitles";
interface VideoWorkspace {
  jobs: AgentVideoJob[];
  transcripts: AgentVideoTranscript[];
}
type CompletedJob = AgentVideoJob & { campaignVersion: number };
interface SocialVideoPanelProps {
  threadId: string;
  campaign?: Stored<Campaign> | undefined;
  assets?: MediaAsset[] | undefined;
}
export function SocialVideoPanel(props: SocialVideoPanelProps) {
  return (
    <SocialVideoEditor
      key={`${props.threadId}:${(props.campaign?.value as (Campaign & { ownerKey?: string }) | undefined)?.ownerKey ?? ""}:${props.campaign?.value.id ?? ""}`}
      {...props}
    />
  );
}
function SocialVideoEditor({ threadId, campaign, assets = [] }: SocialVideoPanelProps) {
  const id = useId();
  const client = useQueryClient();
  const [chosenId, setChosenId] = useState("");
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("");
  const [cover, setCover] = useState("");
  const [crop, setCrop] = useState<"original" | "vertical">("original");
  const [focalPoint, setFocalPoint] = useState({ x: 0.5, y: 0.5 });
  const sourcePlayer = useRef<HTMLVideoElement>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [segments, setSegments] = useState<(AgentVideoSubtitle & { key: string })[]>([]);
  const [transcript, setTranscript] = useState<AgentVideoTranscript | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [versionOverride, setVersionOverride] = useState<{
    campaignId: string;
    version: number;
  } | null>(null);
  const queryKey = [
    "social-agent-video",
    threadId,
    (campaign?.value as (Campaign & { ownerKey?: string }) | undefined)?.ownerKey,
    campaign?.value.id,
  ];
  const workspace = useQuery({
    queryKey,
    queryFn: () =>
      agentCommand<VideoWorkspace>(threadId, "djl_repurpose_video", { action: "list" }),
    enabled: !!threadId && !!campaign,
    retry: false,
    refetchInterval: (query) =>
      busy === "render" || query.state.data?.jobs.some((j) => j.status === "rendering")
        ? 1500
        : false,
  });
  const videos = assets.filter(
    (asset) => asset.mime.startsWith("video/") && campaign?.value.assetIds.includes(asset.id),
  );
  const source = videos.find((asset) => asset.id === chosenId) ?? videos[0];
  const endValue = end || String(Math.min(source?.duration ?? 30, 120));
  const jobs = workspace.data?.jobs ?? [];
  const transcripts = (workspace.data?.transcripts ?? []).filter((t) => t.assetId === source?.id);
  const latestVersion = Math.max(
    campaign?.version ?? 0,
    versionOverride?.campaignId === campaign?.value.id ? (versionOverride?.version ?? 0) : 0,
    ...jobs.filter((j) => j.campaignId === campaign?.value.id).map((j) => j.campaignVersion ?? 0),
  );
  async function refreshDraft() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["marketing-chat", threadId] }),
      client.invalidateQueries({ queryKey: ["marketing"] }),
      client.invalidateQueries({ queryKey: ["social-agent"] }),
    ]);
  }
  async function run(action: string, operation: () => Promise<void>) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Video processing failed. Refresh the draft and try again.",
      );
    } finally {
      setBusy(null);
      await refreshDraft();
      void workspace.refetch();
    }
  }
  function range() {
    const from = Number(start),
      to = Number(endValue);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < 0 ||
      to <= from ||
      to - from > 120 ||
      (source?.duration !== undefined && to > source.duration)
    )
      throw new Error("Choose a valid source range of up to 120 seconds.");
    return { start: from, end: to };
  }
  async function renderClip() {
    if (!campaign || !source) return;
    await run("render", async () => {
      const selected = range();
      const coverAt = cover.trim() ? Number(cover) : undefined;
      if (
        coverAt !== undefined &&
        (!Number.isFinite(coverAt) || coverAt < selected.start || coverAt >= selected.end)
      )
        throw new Error("Cover time must fall inside the selected source range.");
      const result = await agentCommand<CompletedJob>(threadId, "djl_repurpose_video", {
        action: "render",
        campaignId: campaign.value.id,
        version: latestVersion,
        assetId: source.id,
        clips: [
          {
            ...selected,
            crop,
            ...(crop === "vertical" ? { focalPoint } : {}),
            ...(coverAt !== undefined ? { coverAt } : {}),
            ...(!transcript && segments.length
              ? { subtitles: segments.map(({ key: _key, ...segment }) => segment) }
              : {}),
          },
        ],
        ...(transcript
          ? { subtitleProvenance: "transcript", transcriptId: transcript.id }
          : segments.length
            ? { subtitleProvenance: "user-provided" }
            : {}),
      });
      if (result.status !== "complete")
        throw new Error("The export has not completed. Check its saved job status.");
      setVersionOverride({ campaignId: campaign.value.id, version: result.campaignVersion });
      const firstClip = result.clips[0];
      if (firstClip) {
        setChosenId(firstClip.assetId);
        setStart("0");
        setEnd(String(firstClip.duration));
        setCover("");
        setCoverPreview("");
        setSegments([]);
        setTranscript(null);
      }
      client.setQueryData<VideoWorkspace>(queryKey, (previous) => ({
        jobs: [result, ...(previous?.jobs ?? []).filter((j) => j.id !== result.id)],
        transcripts: previous?.transcripts ?? [],
      }));
      setNotice("Clip rendered. Watch the output and review its cover before publishing.");
    });
  }
  async function transcribeRange() {
    if (!campaign || !source) return;
    await run("transcribe", async () => {
      const result = await agentCommand<AgentVideoTranscribeResult>(
        threadId,
        "djl_transcribe_video",
        { campaignId: campaign.value.id, assetId: source.id, ...range() },
      );
      if (result.status === "unavailable") {
        setError(result.nextStep);
        return;
      }
      setTranscript(result.transcript);
      setSegments(
        result.transcript.segments.map((segment, index) =>
          Object.assign({}, segment, { key: `${result.transcript.id}:${index}` }),
        ),
      );
      setNotice(
        "Transcript ready. Each timestamp spans an audio chunk; review text and timing before rendering.",
      );
    });
  }
  function editSegment(index: number, patch: Partial<AgentVideoSubtitle>) {
    setTranscript(null);
    setSegments((current) =>
      current.map((segment, i) => (i === index ? Object.assign({}, segment, patch) : segment)),
    );
  }
  function captureCover() {
    const player = sourcePlayer.current;
    if (!player?.videoWidth || !player.videoHeight || player.readyState < 2) {
      setError("Play or seek the source video before choosing a cover frame.");
      return;
    }
    try {
      const selected = range();
      if (player.currentTime < selected.start || player.currentTime >= selected.end)
        throw new Error("Seek inside the selected clip before choosing its cover.");
      const width = player.videoWidth,
        height = player.videoHeight;
      const cropWidth = crop === "vertical" ? Math.min(width, (height * 9) / 16) : width;
      const cropHeight = crop === "vertical" ? Math.min(height, (width * 16) / 9) : height;
      const canvas = document.createElement("canvas");
      canvas.width = 270;
      canvas.height = Math.round((270 * cropHeight) / cropWidth);
      canvas
        .getContext("2d")!
        .drawImage(
          player,
          (width - cropWidth) * focalPoint.x,
          (height - cropHeight) * focalPoint.y,
          cropWidth,
          cropHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      setCoverPreview(canvas.toDataURL("image/png"));
      setCover(String(Math.floor(player.currentTime * 1000) / 1000));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "The cover frame could not be previewed.");
    }
  }
  return (
    <section className="social-agent-panel" aria-label="Video repurposing">
      <div>
        <h3>Make a clip from your video</h3>
        <p>Choose moments after watching the source. Originals stay in your media library.</p>
      </div>
      {error || workspace.error ? (
        <p role="alert">
          {error ||
            (workspace.error instanceof Error
              ? workspace.error.message
              : "Saved video jobs could not be loaded.")}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!campaign || !source ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Add a video to this draft</EmptyTitle>
            <EmptyDescription>
              Attach a video in chat and prepare a campaign to unlock clips, covers and timestamped
              subtitles.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-source`}>Source video</FieldLabel>
            <Select
              value={source.id}
              disabled={!!busy}
              onValueChange={(value) => {
                if (!value) return;
                setChosenId(value);
                setStart("0");
                setEnd("");
                setCover("");
                setCoverPreview("");
                setFocalPoint({ x: 0.5, y: 0.5 });
                setSegments([]);
                setTranscript(null);
                setError("");
              }}
            >
              <SelectTrigger id={`${id}-source`}>
                <SelectValue>{source.name}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {videos.map((video) => (
                  <SelectItem key={video.id} value={video.id}>
                    {video.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>
          <video
            ref={sourcePlayer}
            className="social-agent-media"
            aria-label="Source video preview"
            key={source.id}
            controls
            preload="metadata"
            src={mediaUrl(source.id)}
            style={
              crop === "vertical"
                ? {
                    width: "min(100%, 270px)",
                    maxHeight: "none",
                    aspectRatio: "9 / 16",
                    objectFit: "cover",
                    objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%`,
                  }
                : undefined
            }
          />
          {crop === "vertical" ? (
            <div className="space-y-3">
              <p>Manual crop preview · move the frame to keep what matters in view.</p>
              {(["x", "y"] as const).map((axis) => (
                <Field key={axis}>
                  <FieldLabel htmlFor={`${id}-focal-${axis}`}>
                    {axis === "x" ? "Horizontal crop position" : "Vertical crop position"}
                  </FieldLabel>
                  <input
                    id={`${id}-focal-${axis}`}
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={focalPoint[axis]}
                    disabled={!!busy}
                    onChange={(event) => {
                      setFocalPoint((current) => ({
                        ...current,
                        [axis]: Number(event.target.value),
                      }));
                      setCoverPreview("");
                    }}
                  />
                </Field>
              ))}
            </div>
          ) : null}
          <div className="social-agent-grid">
            <Field>
              <FieldLabel htmlFor={`${id}-start`}>Start (seconds)</FieldLabel>
              <Input
                id={`${id}-start`}
                type="number"
                min={0}
                step="0.1"
                value={start}
                disabled={!!busy}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-end`}>End (seconds)</FieldLabel>
              <Input
                id={`${id}-end`}
                type="number"
                min={0}
                max={source.duration}
                step="0.1"
                value={endValue}
                disabled={!!busy}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-crop`}>Frame</FieldLabel>
              <Select
                value={crop}
                disabled={!!busy}
                onValueChange={(value) => {
                  if (value === "original" || value === "vertical") {
                    setCrop(value);
                    setCoverPreview("");
                  }
                }}
              >
                <SelectTrigger id={`${id}-crop`}>
                  <SelectValue>
                    {crop === "original" ? "Original aspect ratio" : "Vertical · 9:16"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="original">Original aspect ratio</SelectItem>
                  <SelectItem value="vertical">Vertical · 9:16</SelectItem>
                </SelectPopup>
              </Select>
              <FieldDescription>
                Vertical uses your manual position. Watch the crop preview before rendering.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-cover`}>Cover time (seconds)</FieldLabel>
              <Input
                id={`${id}-cover`}
                type="number"
                min={0}
                step="0.1"
                value={cover}
                placeholder="Clip start"
                disabled={!!busy}
                onChange={(e) => {
                  setCover(e.target.value);
                  setCoverPreview("");
                  const player = sourcePlayer.current;
                  if (player && Number.isFinite(Number(e.target.value)))
                    player.currentTime = Number(e.target.value);
                }}
              />
              <FieldDescription>Use a time on the original video timeline.</FieldDescription>
            </Field>
          </div>
          <div className="social-agent-actions">
            <Button variant="outline" disabled={!!busy} onClick={captureCover}>
              Use current frame as cover
            </Button>
            <span>
              Seek the video, then select its frame. The export includes the rendered cover.
            </span>
          </div>
          {coverPreview ? (
            <img
              src={coverPreview}
              alt="Selected cover frame preview"
              style={{ maxWidth: 270, maxHeight: 480 }}
            />
          ) : null}
          <details>
            <summary className="cursor-pointer py-3 text-sm font-medium">
              Subtitles · optional
            </summary>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Subtitles</CardTitle>
                <CardDescription>
                  Transcribe the selected range or supply text you know is accurate. All times refer
                  to the original video.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="social-agent-actions">
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void transcribeRange()}
                  >
                    {busy === "transcribe" ? "Transcribing…" : "Transcribe selected range"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!!busy || segments.length >= 60}
                    onClick={() => {
                      setTranscript(null);
                      setSegments((current) => [
                        ...current,
                        {
                          start: Number(start) || 0,
                          end: Number(endValue),
                          text: "",
                          key: crypto.randomUUID(),
                        },
                      ]);
                    }}
                  >
                    Add subtitle
                  </Button>
                  <Field>
                    <FieldLabel htmlFor={`${id}-subtitle-file`}>Import SRT or VTT</FieldLabel>
                    <Input
                      id={`${id}-subtitle-file`}
                      type="file"
                      accept=".srt,.vtt"
                      disabled={!!busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        void run("import-subtitles", async () => {
                          if (file.size > 256_000)
                            throw new Error("Subtitle files must be below 256 KB.");
                          const imported = parseVideoSubtitles(await file.text());
                          const selected = range();
                          const inRange = imported
                            .filter(
                              (segment) =>
                                segment.end > selected.start && segment.start < selected.end,
                            )
                            .map((segment) => ({
                              text: segment.text,
                              start: Math.max(segment.start, selected.start),
                              end: Math.min(segment.end, selected.end),
                              key: crypto.randomUUID(),
                            }));
                          if (!inRange.length)
                            throw new Error(
                              "No imported subtitles overlap this source range. Times use the original video timeline.",
                            );
                          setTranscript(null);
                          setSegments(inRange);
                          setNotice(
                            "Subtitles imported as supplied text. Review the wording and source times before rendering.",
                          );
                        });
                      }}
                    />
                  </Field>
                  {segments.length ? (
                    <Button
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() => {
                        setSegments([]);
                        setTranscript(null);
                      }}
                    >
                      Clear subtitles
                    </Button>
                  ) : null}
                </div>
                {transcripts.length ? (
                  <Field>
                    <FieldLabel htmlFor={`${id}-saved`}>Saved transcript</FieldLabel>
                    <Select
                      value={transcript?.id ?? null}
                      disabled={!!busy}
                      onValueChange={(value) => {
                        const saved = transcripts.find((t) => t.id === value);
                        if (saved) {
                          setTranscript(saved);
                          setSegments(
                            saved.segments.map((segment, index) =>
                              Object.assign({}, segment, { key: `${saved.id}:${index}` }),
                            ),
                          );
                        }
                      }}
                    >
                      <SelectTrigger id={`${id}-saved`}>
                        <SelectValue placeholder="Choose a saved transcript" />
                      </SelectTrigger>
                      <SelectPopup>
                        {transcripts.map((saved) => (
                          <SelectItem key={saved.id} value={saved.id}>
                            {new Date(saved.createdAt).toLocaleString()} · {saved.segments.length}{" "}
                            audio chunks
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </Field>
                ) : null}
                {segments.length ? (
                  <p>
                    {transcript
                      ? "Codex transcription · audio chunk timing, not word timing. Editing makes these supplied subtitles."
                      : "Supplied / edited subtitles · verify every line against the audio."}
                  </p>
                ) : null}
                {segments.map((segment, index) => (
                  <div key={segment.key} className="space-y-2">
                    <div className="social-agent-grid">
                      <Field>
                        <FieldLabel htmlFor={`${id}-subtitle-${index}-start`}>
                          Subtitle start {index + 1}
                        </FieldLabel>
                        <Input
                          id={`${id}-subtitle-${index}-start`}
                          type="number"
                          min={0}
                          step="0.1"
                          value={segment.start}
                          disabled={!!busy}
                          onChange={(e) => editSegment(index, { start: Number(e.target.value) })}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`${id}-subtitle-${index}-end`}>
                          Subtitle end {index + 1}
                        </FieldLabel>
                        <Input
                          id={`${id}-subtitle-${index}-end`}
                          type="number"
                          min={0}
                          step="0.1"
                          value={segment.end}
                          disabled={!!busy}
                          onChange={(e) => editSegment(index, { end: Number(e.target.value) })}
                        />
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel htmlFor={`${id}-subtitle-${index}-text`}>
                        Subtitle text {index + 1}
                      </FieldLabel>
                      <Textarea
                        id={`${id}-subtitle-${index}-text`}
                        value={segment.text}
                        maxLength={1000}
                        disabled={!!busy}
                        onChange={(e) => editSegment(index, { text: e.target.value })}
                      />
                    </Field>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => {
                        setTranscript(null);
                        setSegments((current) => current.filter((_, i) => i !== index));
                      }}
                    >
                      Remove subtitle {index + 1}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </details>
          <div className="social-agent-actions">
            <Button disabled={!!busy} onClick={() => void renderClip()}>
              {busy === "render" ? "Rendering clip…" : "Render clip"}
            </Button>
            <span>H.264 MP4 · up to 120 seconds · automatically compressed to 25 MB</span>
          </div>
        </>
      )}
      <div className="social-agent-actions">
        <h4>Saved video work</h4>
        <Button
          variant="ghost"
          size="sm"
          disabled={workspace.isFetching}
          onClick={() => void workspace.refetch()}
        >
          Refresh jobs
        </Button>
      </div>
      {workspace.isLoading ? (
        <p role="status">Loading saved video jobs…</p>
      ) : !jobs.length ? (
        <p>Completed clips and interrupted exports will appear here.</p>
      ) : (
        jobs.map((job) => (
          <Card key={job.id} size="sm">
            <CardHeader>
              <CardTitle>
                {job.status === "complete"
                  ? "Ready to review"
                  : job.status === "rendering"
                    ? "Rendering video"
                    : `Export ${job.status}`}
              </CardTitle>
              <CardDescription>{new Date(job.createdAt).toLocaleString()}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {job.error ? <p role="alert">{job.error}</p> : null}
              {job.status === "rendering" ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    void agentCommand(threadId, "djl_repurpose_video", {
                      action: "cancel",
                      jobId: job.id,
                    })
                      .then(() => workspace.refetch())
                      .catch((e) =>
                        setError(
                          e instanceof Error ? e.message : "Cancel failed. Refresh the job status.",
                        ),
                      )
                  }
                >
                  Cancel export
                </Button>
              ) : null}
              {job.clips.map((clip, index) => (
                <div key={clip.assetId} className="space-y-3">
                  <p>
                    Clip {index + 1} · {clip.start}–{clip.end}s ·{" "}
                    {clip.crop === "vertical" ? "9:16" : "original aspect ratio"}
                    {clip.bytes ? ` · ${(clip.bytes / 1_000_000).toFixed(1)} MB` : ""}
                  </p>
                  <video
                    className="social-agent-media"
                    aria-label={`Rendered clip ${index + 1}`}
                    controls
                    preload="metadata"
                    poster={mediaUrl(clip.coverAssetId)}
                    src={mediaUrl(clip.assetId)}
                  />
                  <img
                    className="social-agent-media"
                    loading="lazy"
                    src={mediaUrl(clip.coverAssetId)}
                    alt={`Cover for clip ${index + 1}`}
                  />
                  <div className="social-agent-actions">
                    <Button
                      variant="outline"
                      disabled={!!busy || !campaign || job.campaignId !== campaign.value.id}
                      onClick={() =>
                        void run("select", async () => {
                          if (!campaign) return;
                          const saved = (await command({
                            action: "update",
                            id: campaign.value.id,
                            version: latestVersion,
                            patch: { assetIds: [clip.assetId] },
                          })) as Stored<Campaign>;
                          setVersionOverride({
                            campaignId: campaign.value.id,
                            version: saved.version,
                          });
                          setChosenId(clip.assetId);
                          setStart("0");
                          setEnd(String(clip.duration));
                          setCover("");
                          setSegments([]);
                          setTranscript(null);
                          setNotice("Clip selected for this draft. Review before publishing.");
                        })
                      }
                    >
                      Use clip
                    </Button>
                    <a href={mediaUrl(clip.assetId, false, true)} download>
                      Download clip
                    </a>
                    <a href={mediaUrl(clip.coverAssetId, false, true)} download>
                      Download cover
                    </a>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </section>
  );
}

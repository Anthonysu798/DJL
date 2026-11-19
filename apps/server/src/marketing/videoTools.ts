import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { Effect, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  reviseCampaign,
  type Campaign,
  type MediaAsset,
  type ServerVoiceTranscriptionInput,
  type ServerVoiceTranscriptionResult,
} from "@synara/contracts";
import type {
  AgentVideoClipInput,
  AgentVideoClipResult,
  AgentVideoJob,
  AgentVideoTranscript,
} from "@synara/contracts";
import type { MarketingToolScope } from "./chatTools";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry";
import { VoiceTranscriptionError } from "../voiceTranscription";
import { resolveAgentOwner, assertAgentCampaignAccess, assertAgentMediaAccess } from "./agentScope";
import { listDocuments, readDocument, saveDocument, MarketingError } from "./store";
import {
  extractVideoAudio,
  renderVideoClip,
  sourceVideo,
  validateVideoClips,
} from "./videoProcessing";
const uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);
const subtitle = Schema.Struct({ start: Schema.Number, end: Schema.Number, text: Schema.String });
const clipSchema = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  crop: Schema.Literals(["original", "vertical"]),
  focalPoint: Schema.optional(Schema.Struct({ x: Schema.Number, y: Schema.Number })),
  coverAt: Schema.optional(Schema.Number),
  subtitles: Schema.optional(Schema.Array(subtitle)),
});
const renderSchema = Schema.Struct({
  action: Schema.Literal("render"),
  campaignId: uuid,
  version: Schema.Number,
  assetId: uuid,
  clips: Schema.Array(clipSchema),
  subtitleProvenance: Schema.optional(Schema.Literals(["user-provided", "transcript"])),
  transcriptId: Schema.optional(uuid),
});
const jobSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literal("list") }),
  Schema.Struct({ action: Schema.Literals(["get", "cancel"]), jobId: uuid }),
]);
const transcribeSchema = Schema.Struct({
  campaignId: uuid,
  assetId: uuid,
  start: Schema.optional(Schema.Number),
  end: Schema.optional(Schema.Number),
  chunkSeconds: Schema.optional(Schema.Number),
});
type VideoTranscriber = (
  input: ServerVoiceTranscriptionInput,
) => Effect.Effect<ServerVoiceTranscriptionResult, unknown>;
const transcribers = new Map<string, VideoTranscriber>();
/** Register a server-owned provider callback after adapter construction, avoiding a circular MCP dependency. */
export function registerVideoTranscriber(stateDir: string, transcribe: VideoTranscriber) {
  const key = path.resolve(stateDir);
  transcribers.set(key, transcribe);
  return () => {
    if (transcribers.get(key) === transcribe) transcribers.delete(key);
  };
}
const running = new Map<string, AbortController>();
const attempt = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({
    try: f,
    catch: (e) => new MarketingError(e instanceof Error ? e.message : "Video processing failed."),
  });
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  raw: unknown,
) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(raw),
    catch: () =>
      new MarketingError(
        "Invalid video tool input. Use campaign/asset IDs and valid numeric times, never file paths.",
      ),
  });
const limits =
  "24 kHz mono PCM WAV; each chunk at most 120 seconds and 10 MB; at most 10 minutes per request. Transcript timestamps mark audio chunks, not individual words or sentences.";
const unavailable = () => ({
  status: "unavailable",
  nextStep:
    "Connect and sign in to the Codex provider with voice transcription support, or supply your own timestamped subtitles with subtitleProvenance='user-provided'.",
  limits,
});
const clipProperties = {
  start: { type: "number", description: "Seconds on original timeline." },
  end: { type: "number" },
  crop: { type: "string", enum: ["original", "vertical"] },
  focalPoint: {
    type: "object",
    properties: {
      x: { type: "number", minimum: 0, maximum: 1 },
      y: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["x", "y"],
    additionalProperties: false,
    description:
      "Manual crop position: 0 left/top, 0.5 center, 1 right/bottom. No automatic subject detection.",
  },
  coverAt: { type: "number", description: "Cover time on original timeline, inside the clip." },
  subtitles: {
    type: "array",
    maxItems: 60,
    items: {
      type: "object",
      properties: { start: { type: "number" }, end: { type: "number" }, text: { type: "string" } },
      required: ["start", "end", "text"],
      additionalProperties: false,
    },
  },
};
export const VIDEO_TOOLS = [
  {
    name: "djl_repurpose_video",
    description:
      "Render real clips up to 25 MB with automatic compression, manual vertical crop position, cover frames and optional supplied timestamped subtitles from an owned campaign video. First inspect actual sampled frames using djl_inspect_social_media and/or transcribe audio before proposing highlights; metadata and filenames are not content evidence. Render preserves the original and links new assets to the current draft; it never publishes. Times use original timeline seconds. Jobs persist; list/get recovers interrupted jobs; cancel aborts an active job. Encoding retries at most twice (up to five minutes per command).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["render", "list", "get", "cancel"] },
        campaignId: { type: "string" },
        version: { type: "integer" },
        assetId: { type: "string" },
        clips: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: clipProperties,
            required: ["start", "end", "crop"],
            additionalProperties: false,
          },
        },
        subtitleProvenance: { type: "string", enum: ["user-provided", "transcript"] },
        transcriptId: { type: "string" },
        jobId: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "djl_transcribe_video",
    description:
      "Transcribe an owned current-campaign video through the signed-in Codex provider, using real 24kHz mono WAV chunks. Returns source timeline chunk-level timestamps (not word timings) and provenance; never invent speech. Service unavailability returns a next step. Inputs contain no credentials or file paths.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        assetId: { type: "string" },
        start: { type: "number" },
        end: { type: "number" },
        chunkSeconds: { type: "number", minimum: 5, maximum: 120 },
      },
      required: ["campaignId", "assetId"],
      additionalProperties: false,
    },
  },
];
function ownedSource(
  scope: MarketingToolScope,
  owner: Effect.Success<ReturnType<typeof resolveAgentOwner>>,
  campaignId: string,
  assetId: string,
  version?: number,
) {
  return Effect.gen(function* () {
    const row = yield* readDocument("campaign", campaignId);
    const campaign = row?.value as (Campaign & { ownerKey?: string }) | undefined;
    if (!campaign || campaign.threadId !== scope.threadId || !campaign.assetIds.includes(assetId))
      return yield* Effect.fail(
        new MarketingError(
          "Video is missing or is not owned by this account and conversation. Prepare it in this chat first.",
          404,
        ),
      );
    yield* assertAgentCampaignAccess(scope, campaign, owner);
    if (version !== undefined && (!Number.isInteger(version) || row!.version !== version))
      return yield* Effect.fail(
        new MarketingError("Campaign changed. Reload its current version before rendering.", 409),
      );
    const asset = (yield* readDocument("asset", assetId))?.value as
      | (MediaAsset & { ownerKey?: string })
      | undefined;
    if (!asset || !asset.mime.startsWith("video/"))
      return yield* Effect.fail(
        new MarketingError("Choose an owned video asset from this campaign.", 404),
      );
    yield* assertAgentMediaAccess(scope, asset, owner);
    const video = yield* attempt(() => sourceVideo(scope.stateDir, assetId));
    return { campaign, version: row!.version, ...video };
  });
}
function readOwnedJob(scope: MarketingToolScope, ownerKey: string, id: string) {
  return Effect.gen(function* () {
    const row = yield* readDocument("agent-video-job", `${ownerKey}:${id}`);
    const job = row?.value as AgentVideoJob | undefined;
    if (!job || job.ownerKey !== ownerKey || job.threadId !== scope.threadId)
      return yield* Effect.fail(
        new MarketingError("Video job not found in this conversation.", 404),
      );
    if (job.status === "rendering" && !running.has(`${ownerKey}:${id}`)) {
      const recovered = {
        ...job,
        status: "interrupted" as const,
        updatedAt: new Date().toISOString(),
        error:
          "DJL stopped during processing. The original is safe. Review the campaign version and render again.",
      };
      const saved = yield* saveDocument(
        "agent-video-job",
        `${ownerKey}:${id}`,
        recovered,
        row!.version,
      );
      return { job: recovered, version: saved.version };
    }
    return { job: job!, version: row!.version };
  });
}
export function executeVideoTool(scope: MarketingToolScope, name: string, raw: unknown) {
  return Effect.gen(function* () {
    const owner = yield* resolveAgentOwner(scope);
    if (name === "djl_transcribe_video") {
      const input = yield* decode(transcribeSchema, raw);
      const source = yield* ownedSource(scope, owner, input.campaignId, input.assetId);
      const start = input.start ?? 0,
        end = input.end ?? source.meta.duration,
        chunkSeconds = input.chunkSeconds ?? 30;
      if (
        ![start, end, chunkSeconds].every(Number.isFinite) ||
        start < 0 ||
        end <= start ||
        end > source.meta.duration ||
        end - start > 600 ||
        chunkSeconds < 5 ||
        chunkSeconds > 120
      )
        return yield* Effect.fail(
          new MarketingError("Choose a source range up to 10 minutes and chunks of 5–120 seconds."),
        );
      if (!source.meta.hasAudio)
        return {
          status: "unavailable",
          nextStep:
            "This video has no audio stream. Supply timestamped text if captions are needed.",
          limits,
        };
      const registry = yield* Effect.serviceOption(ProviderAdapterRegistry);
      let transcribe = transcribers.get(path.resolve(scope.stateDir));
      if (!transcribe && Option.isSome(registry)) {
        const adapter = yield* registry.value.getByProvider("codex").pipe(
          Effect.map(Option.some),
          Effect.catch(() => Effect.succeed(Option.none())),
        );
        if (Option.isSome(adapter)) transcribe = adapter.value.transcribeVoice;
      }
      if (!transcribe) return unavailable();
      const transcribeAudio = transcribe;
      const temp = yield* attempt(async () => {
        const root = path.join(scope.stateDir, "marketing", "video-work");
        await mkdir(root, { recursive: true });
        return mkdtemp(path.join(root, "transcribe-"));
      });
      const controller = new AbortController();
      const transcript: AgentVideoTranscript = {
        id: crypto.randomUUID(),
        ownerKey: owner.key,
        threadId: scope.threadId,
        assetId: input.assetId,
        campaignId: input.campaignId,
        provenance: "codex-transcription",
        timing: "audio-chunk",
        segments: [],
        createdAt: new Date().toISOString(),
        limitations:
          "Service supplies plain text. Each segment spans its actual extracted audio chunk; timing is not word- or sentence-aligned. Review before burning subtitles.",
      };
      yield* Effect.gen(function* () {
        for (let offset = start; offset < end; offset += chunkSeconds) {
          const chunkEnd = Math.min(end, offset + chunkSeconds);
          const audio = yield* attempt(() =>
            extractVideoAudio(
              source.source,
              offset,
              chunkEnd,
              path.join(temp, "audio.wav"),
              controller.signal,
            ),
          );
          const result = yield* transcribeAudio({
            provider: "codex",
            cwd: scope.authorizedRoot,
            mimeType: "audio/wav",
            sampleRateHz: 24000,
            durationMs: Math.ceil((chunkEnd - offset) * 1000),
            audioBase64: audio.toString("base64"),
          }).pipe(
            Effect.mapError((error) => {
              const failure =
                error instanceof VoiceTranscriptionError
                  ? error
                  : error instanceof Error && error.cause instanceof VoiceTranscriptionError
                    ? error.cause
                    : null;
              return new MarketingError(
                failure?.message ??
                  "Automatic transcription could not complete. Retry later or supply timestamped subtitles.",
                failure?.status ?? 503,
              );
            }),
          );
          if (!result.text.trim() || result.text.length > 20000)
            return yield* Effect.fail(
              new MarketingError(
                "Transcription returned empty or oversized text. Try a shorter audio chunk.",
                503,
              ),
            );
          transcript.segments.push({ start: offset, end: chunkEnd, text: result.text.trim() });
        }
        if ((yield* resolveAgentOwner(scope)).key !== owner.key)
          return yield* Effect.fail(
            new MarketingError(
              "Account changed during transcription. Switch back and try again.",
              409,
            ),
          );
        yield* saveDocument(
          "agent-video-transcript",
          `${owner.key}:${transcript.id}`,
          transcript,
          null,
        );
      }).pipe(
        Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
        Effect.ensuring(Effect.promise(() => rm(temp, { recursive: true, force: true }))),
      );
      return { status: "complete", transcript, limits };
    }
    if (name !== "djl_repurpose_video")
      return yield* Effect.fail(new MarketingError("Unknown video tool."));
    if ((raw as { action?: unknown })?.action !== "render") {
      const input = yield* decode(jobSchema, raw);
      if (input.action === "list") {
        const rows = yield* listDocuments("agent-video-job");
        const jobs = [];
        for (const row of rows) {
          const job = row.value as AgentVideoJob;
          if (job.ownerKey === owner.key && job.threadId === scope.threadId)
            jobs.push((yield* readOwnedJob(scope, owner.key, job.id)).job);
        }
        const transcripts = (yield* listDocuments("agent-video-transcript"))
          .map((r) => r.value as AgentVideoTranscript)
          .filter((t) => t.ownerKey === owner.key && t.threadId === scope.threadId);
        return { jobs, transcripts, limits };
      }
      const { job, version } = yield* readOwnedJob(scope, owner.key, input.jobId);
      if (input.action === "cancel") {
        const controller = running.get(`${owner.key}:${job.id}`);
        if (!controller)
          return yield* Effect.fail(
            new MarketingError("This video job is no longer running.", 409),
          );
        controller.abort();
        return { jobId: job.id, status: "cancel-requested" };
      }
      return { ...job, version };
    }
    const input = yield* decode(renderSchema, raw);
    const source = yield* ownedSource(scope, owner, input.campaignId, input.assetId, input.version);
    const clips: AgentVideoClipInput[] = input.clips.map((c) => ({
      start: c.start,
      end: c.end,
      crop: c.crop,
      ...(c.focalPoint ? { focalPoint: c.focalPoint } : {}),
      ...(c.coverAt !== undefined ? { coverAt: c.coverAt } : {}),
      ...(c.subtitles ? { subtitles: [...c.subtitles] } : {}),
    }));
    if (input.subtitleProvenance === "transcript") {
      if (!input.transcriptId || clips.some((c) => c.subtitles?.length))
        return yield* Effect.fail(
          new MarketingError(
            "Choose a saved transcriptId and omit custom subtitles when using transcript provenance.",
          ),
        );
      const transcript = (yield* readDocument(
        "agent-video-transcript",
        `${owner.key}:${input.transcriptId}`,
      ))?.value as AgentVideoTranscript | undefined;
      if (
        !transcript ||
        transcript.ownerKey !== owner.key ||
        transcript.threadId !== scope.threadId ||
        transcript.assetId !== input.assetId
      )
        return yield* Effect.fail(
          new MarketingError("Transcript does not belong to this video and account.", 404),
        );
      for (const clip of clips)
        clip.subtitles = transcript.segments
          .filter((s) => s.end > clip.start && s.start < clip.end)
          .map((s) => ({
            text: s.text,
            start: Math.max(s.start, clip.start),
            end: Math.min(s.end, clip.end),
          }));
    } else if (
      clips.some((c) => c.subtitles?.length) &&
      input.subtitleProvenance !== "user-provided"
    )
      return yield* Effect.fail(
        new MarketingError(
          "Timestamped subtitles need explicit user-provided provenance or a saved transcript. Never invent speech.",
        ),
      );
    yield* Effect.try({
      try: () => validateVideoClips(clips, source.meta.duration),
      catch: (e) => new MarketingError(String(e)),
    });
    if (running.size >= 2)
      return yield* Effect.fail(
        new MarketingError("Two video exports are running. Wait for one or cancel it.", 409),
      );
    const job: AgentVideoJob = {
      id: crypto.randomUUID(),
      ownerKey: owner.key,
      threadId: scope.threadId,
      campaignId: input.campaignId,
      sourceAssetId: input.assetId,
      status: "rendering",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      clips: [],
    };
    const key = `${owner.key}:${job.id}`,
      controller = new AbortController();
    running.set(key, controller);
    yield* saveDocument("agent-video-job", key, job, null).pipe(
      Effect.onError(() => Effect.sync(() => running.delete(key))),
    );
    const outputs: string[] = [];
    let temp: string | undefined;
    const operation = Effect.gen(function* () {
      temp = yield* attempt(async () => {
        const dir = path.join(scope.stateDir, "marketing", "video-work");
        await mkdir(dir, { recursive: true });
        return mkdtemp(path.join(dir, "render-"));
      });
      const assets: (MediaAsset & { ownerKey: string })[] = [];
      for (const [index, clip] of clips.entries()) {
        const dir = path.join(temp, String(index));
        yield* attempt(() => mkdir(dir));
        const rendered = yield* attempt(() =>
          renderVideoClip(source.source, clip, dir, controller.signal),
        );
        const assetId = crypto.randomUUID(),
          coverAssetId = crypto.randomUUID(),
          root = path.join(scope.stateDir, "marketing", "originals");
        for (const [from, id] of [
          [rendered.output, assetId],
          [rendered.cover, coverAssetId],
        ]) {
          const target = path.join(root, id!);
          yield* attempt(() => copyFile(from!, target, constants.COPYFILE_EXCL));
          outputs.push(target);
        }
        assets.push(
          {
            id: assetId,
            ownerKey: owner.key,
            name: `clip-${index + 1}.mp4`,
            mime: "video/mp4",
            bytes: rendered.bytes,
            createdAt: new Date().toISOString(),
            width: rendered.meta.width,
            height: rendered.meta.height,
            duration: rendered.meta.duration,
          },
          {
            id: coverAssetId,
            ownerKey: owner.key,
            name: `clip-${index + 1}-cover.png`,
            mime: "image/png",
            bytes: (yield* attempt(() => stat(rendered.cover))).size,
            createdAt: new Date().toISOString(),
            width: rendered.meta.width,
            height: rendered.meta.height,
          },
        );
        job.clips.push({
          assetId,
          coverAssetId,
          start: clip.start,
          end: clip.end,
          crop: clip.crop,
          width: rendered.meta.width,
          height: rendered.meta.height,
          duration: rendered.meta.duration,
          subtitleProvenance: clip.subtitles?.length ? (input.subtitleProvenance ?? null) : null,
          bytes: rendered.bytes,
          coverAt: clip.coverAt ?? clip.start,
          ...(clip.focalPoint ? { focalPoint: clip.focalPoint } : {}),
        } satisfies AgentVideoClipResult);
      }
      // Recheck ownership immediately before linking; switching DJL accounts during encoding cannot attach outputs.
      const currentOwner = yield* resolveAgentOwner(scope);
      if (currentOwner.key !== owner.key)
        return yield* Effect.fail(
          new MarketingError("Account changed during export. Switch back and render again.", 409),
        );
      if (controller.signal.aborted)
        return yield* Effect.fail(new MarketingError("Video processing canceled."));
      const sql = yield* SqlClient.SqlClient;
      const saved = yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const asset of assets) yield* saveDocument("asset", asset.id, asset, null);
          for (const [index, clip] of job.clips.entries()) {
            for (const [assetId, description] of [
              [clip.assetId, `Video clip ${clip.start}–${clip.end} seconds, ${clip.crop} crop`],
              [clip.coverAssetId, `Cover frame at ${clips[index]!.coverAt ?? clip.start} seconds`],
            ]) {
              yield* saveDocument(
                "agent-media",
                `${owner.key}:${assetId}`,
                {
                  ownerKey: owner.key,
                  assetId,
                  description,
                  tags: [],
                  transcript: clips[index]!.subtitles?.map((s) => s.text).join(" ") ?? "",
                  evidence: "generated-media",
                },
                null,
              );
            }
          }
          if (!(yield* readDocument("agent-media", `${owner.key}:${input.assetId}`)))
            yield* saveDocument(
              "agent-media",
              `${owner.key}:${input.assetId}`,
              {
                ownerKey: owner.key,
                assetId: input.assetId,
                description: "Original video preserved by clip export",
                tags: [],
                transcript: "",
                evidence: "generated-media",
              },
              null,
            );
          const campaign = reviseCampaign(source.campaign, {
            assetIds: [
              ...source.campaign.assetIds.filter((id) => id !== input.assetId),
              ...job.clips.map((c) => c.assetId),
            ],
          });
          const saved = yield* saveDocument(
            "campaign",
            source.campaign.id,
            campaign,
            source.version,
          );
          job.status = "complete";
          job.campaignVersion = saved.version;
          job.updatedAt = new Date().toISOString();
          yield* saveDocument("agent-video-job", key, job, 1);
          return saved;
        }),
      );
      return {
        ...job,
        version: 2,
        campaignVersion: saved.version,
        limitations:
          "Clips use your selected ranges and manual crop position, defaulting to center. Exports are verified at 25 MB or less; originals and cover frames remain in your media library. Multiple clips require selecting one clip per publishing draft. Review the actual rendered output and any chunk-level subtitles before publication.",
      };
    }).pipe(
      Effect.catch((e) =>
        Effect.gen(function* () {
          job.status = controller.signal.aborted ? "canceled" : "failed";
          job.error = e instanceof Error ? e.message : "Video export failed. Reload and retry.";
          job.updatedAt = new Date().toISOString();
          job.clips = [];
          yield* saveDocument("agent-video-job", key, job, 1);
          for (const output of outputs) yield* Effect.promise(() => rm(output, { force: true }));
          return yield* Effect.fail(e);
        }),
      ),
      Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
      Effect.ensuring(
        Effect.promise(async () => {
          running.delete(key);
          if (job.status !== "complete")
            await Promise.all(outputs.map((output) => rm(output, { force: true })));
          if (temp) await rm(temp, { recursive: true, force: true });
        }),
      ),
    );
    return yield* operation;
  }).pipe(Effect.map((result) => result as Record<string, unknown>));
}

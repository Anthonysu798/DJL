import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { writeCloudSession } from "../cloud/session";
import { createCampaign } from "@synara/contracts";
import { resolveAgentOwner } from "./agentScope";
import { executeVideoTool, registerVideoTranscriber } from "./videoTools";
import { readDocument, saveDocument } from "./store";
import { inspectVideo } from "./media";
import { VoiceTranscriptionError } from "../voiceTranscription";
import { ProviderAdapterRequestError } from "../provider/Errors";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../provider/Services/ProviderAdapterRegistry";
import type { ServerVoiceTranscriptionInput } from "@synara/contracts";
const exec = promisify(execFile);
let assetId = "11111111-1111-4111-8111-111111111111";
function fixture(duration = 3) {
  return Effect.gen(function* () {
    assetId = crypto.randomUUID();
    const root = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "djl-video-tools-")));
    const scope = {
      threadId: crypto.randomUUID(),
      stateDir: root,
      authorizedRoot: root,
      attachmentFiles: [],
      secretsDir: path.join(root, "secrets"),
    };
    yield* Effect.promise(() =>
      writeCloudSession(scope.secretsDir, {
        apiBaseUrl: "https://api.example.com",
        token: "fixture",
        userId: "video-user",
        orgId: "video-org",
        email: "video@example.com",
        createdAt: new Date().toISOString(),
      }),
    );
    const owner = yield* resolveAgentOwner(scope);
    const campaign = {
      ...createCampaign("Video"),
      threadId: scope.threadId,
      ownerKey: owner.key,
      assetIds: [assetId],
    };
    yield* saveDocument("campaign", campaign.id, campaign, null);
    yield* Effect.promise(async () => {
      await mkdir(path.join(root, "marketing", "originals"), { recursive: true });
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=320x240:rate=10:duration=${duration}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:duration=${duration}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        "-f",
        "mp4",
        path.join(root, "marketing", "originals", assetId),
      ]);
    });
    yield* saveDocument(
      "asset",
      assetId,
      {
        id: assetId,
        name: "source.mp4",
        mime: "video/mp4",
        bytes: 1000,
        createdAt: new Date().toISOString(),
        ownerKey: owner.key,
      },
      null,
    );
    return { root, scope, campaign, owner };
  });
}
it.layer(SqlitePersistenceMemory)("video agent tools", (it) => {
  it.effect(
    "renders real original and vertical clips, cover and timed subtitles without changing source",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        try {
          const original = yield* Effect.promise(() =>
            readFile(path.join(f.root, "marketing", "originals", assetId)),
          );
          const result = yield* executeVideoTool(f.scope, "djl_repurpose_video", {
            action: "render",
            campaignId: f.campaign.id,
            version: 1,
            assetId,
            clips: [
              { start: 0, end: 1, crop: "original" },
              {
                start: 1,
                end: 2.5,
                crop: "vertical",
                coverAt: 1.3,
                subtitles: [{ start: 1.1, end: 2, text: "Actual supplied words" }],
              },
            ],
            subtitleProvenance: "user-provided",
          });
          assert.equal(result.status, "complete");
          const clips = result.clips as { assetId: string; coverAssetId: string }[];
          assert.lengthOf(clips, 2);
          const wide = yield* Effect.promise(() =>
            inspectVideo(path.join(f.root, "marketing", "originals", clips[0]!.assetId)),
          );
          const tall = yield* Effect.promise(() =>
            inspectVideo(path.join(f.root, "marketing", "originals", clips[1]!.assetId)),
          );
          assert.closeTo(wide.duration, 1, 0.15);
          assert.closeTo(tall.width / tall.height, 9 / 16, 0.01);
          assert.isAbove(
            (yield* Effect.promise(() =>
              readFile(path.join(f.root, "marketing", "originals", clips[1]!.coverAssetId)),
            )).length,
            100,
          );
          assert.deepEqual(
            yield* Effect.promise(() =>
              readFile(path.join(f.root, "marketing", "originals", assetId)),
            ),
            original,
          );
          const campaign = yield* readDocument("campaign", f.campaign.id);
          assert.equal(campaign?.version, 2);
          assert.equal((campaign!.value as { approvedRevision: null }).approvedRevision, null);
          assert.deepEqual(
            (campaign!.value as { assetIds: string[] }).assetIds,
            clips.map((c) => c.assetId),
          );
          assert.isNotNull(yield* readDocument("agent-media", `${f.owner.key}:${assetId}`));
          assert.isNotNull(
            yield* readDocument("agent-media", `${f.owner.key}:${clips[1]!.coverAssetId}`),
          );
          const list = yield* executeVideoTool(f.scope, "djl_repurpose_video", { action: "list" });
          assert.isAtLeast((list.jobs as unknown[]).length, 1);
        } finally {
          yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
        }
      }),
  );
  it.effect("allows verified bound legacy media and rejects unbound or mismatched bindings", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      try {
        yield* saveDocument("campaign", f.campaign.id, { ...f.campaign, ownerKey: undefined }, 1);
        const asset = yield* readDocument("asset", assetId);
        yield* saveDocument(
          "asset",
          assetId,
          { ...(asset!.value as object), ownerKey: undefined },
          asset!.version,
        );
        const input = {
          action: "render",
          campaignId: f.campaign.id,
          version: 2,
          assetId,
          clips: [{ start: 0, end: 1, crop: "original" }],
        };
        assert.instanceOf(
          yield* executeVideoTool(f.scope, "djl_repurpose_video", input).pipe(Effect.flip),
          Error,
        );
        for (const foreign of [
          { apiBaseUrl: "https://foreign.example.com" },
          { userId: "foreign-user" },
          { orgId: "foreign-org" },
        ]) {
          yield* saveDocument(
            "social-draft-link",
            crypto.randomUUID(),
            {
              campaignId: f.campaign.id,
              userId: f.owner.userId,
              orgId: f.owner.orgId,
              apiBaseUrl: f.owner.apiBaseUrl,
              ...foreign,
            },
            null,
          );
          assert.instanceOf(
            yield* executeVideoTool(f.scope, "djl_repurpose_video", input).pipe(Effect.flip),
            Error,
          );
        }
        yield* saveDocument(
          "social-draft-link",
          crypto.randomUUID(),
          {
            campaignId: f.campaign.id,
            userId: f.owner.userId,
            orgId: f.owner.orgId,
            apiBaseUrl: f.owner.apiBaseUrl,
          },
          null,
        );
        assert.instanceOf(
          yield* executeVideoTool(
            { ...f.scope, threadId: "another-chat" },
            "djl_repurpose_video",
            input,
          ).pipe(Effect.flip),
          Error,
        );
        const result = yield* executeVideoTool(f.scope, "djl_repurpose_video", input);
        assert.equal(result.status, "complete");
        assert.equal(result.campaignVersion, 3);
        for (const clip of result.clips as { assetId: string; coverAssetId: string }[]) {
          for (const id of [clip.assetId, clip.coverAssetId])
            assert.equal(
              ((yield* readDocument("asset", id))!.value as { ownerKey: string }).ownerKey,
              f.owner.key,
            );
        }
      } finally {
        yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect("rejects foreign owner, foreign chat, paths and stale campaign versions", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      try {
        const input = {
          action: "render",
          campaignId: f.campaign.id,
          version: 1,
          assetId,
          clips: [{ start: 0, end: 1, crop: "original" }],
        };
        for (const [scope, args] of [
          [{ ...f.scope, threadId: "foreign" }, input],
          [f.scope, { ...input, version: 99 }],
          [f.scope, { ...input, assetId: "../../outside" }],
        ] as const) {
          assert.instanceOf(
            yield* executeVideoTool(scope, "djl_repurpose_video", args).pipe(Effect.flip),
            Error,
          );
        }
        yield* Effect.promise(() =>
          writeCloudSession(f.scope.secretsDir, {
            apiBaseUrl: "https://api.example.com",
            token: "other",
            userId: "other",
            orgId: "other",
            email: "other@example.com",
            createdAt: new Date().toISOString(),
          }),
        );
        assert.instanceOf(
          yield* executeVideoTool(f.scope, "djl_repurpose_video", input).pipe(Effect.flip),
          Error,
        );
        const list = yield* executeVideoTool(f.scope, "djl_repurpose_video", { action: "list" });
        assert.lengthOf(list.jobs as unknown[], 0);
      } finally {
        yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect("rejects bad ranges, invalid or unproven subtitles and damaged media", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      try {
        const input = { action: "render", campaignId: f.campaign.id, version: 1, assetId };
        for (const args of [
          { ...input, clips: [{ start: -1, end: 2, crop: "original" }] },
          { ...input, clips: [{ start: 0, end: 99, crop: "original" }] },
          {
            ...input,
            clips: [
              { start: 0, end: 2, crop: "original", subtitles: [{ start: 1, end: 0, text: "no" }] },
            ],
            subtitleProvenance: "user-provided",
          },
          {
            ...input,
            clips: [
              {
                start: 0,
                end: 2,
                crop: "original",
                subtitles: [{ start: 0, end: 1, text: "invented" }],
              },
            ],
          },
        ]) {
          assert.instanceOf(
            yield* executeVideoTool(f.scope, "djl_repurpose_video", args).pipe(Effect.flip),
            Error,
          );
        }
        yield* Effect.promise(() =>
          writeFile(path.join(f.root, "marketing", "originals", assetId), "damaged"),
        );
        assert.instanceOf(
          yield* executeVideoTool(f.scope, "djl_repurpose_video", {
            ...input,
            clips: [{ start: 0, end: 1, crop: "original" }],
          }).pipe(Effect.flip),
          Error,
        );
      } finally {
        yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect("normalizes real audio and persists accurately offset chunk transcripts", () =>
    Effect.gen(function* () {
      const f = yield* fixture(6.5);
      const captured: ServerVoiceTranscriptionInput[] = [];
      const registry = {
        getByProvider: () =>
          Effect.succeed({
            transcribeVoice: (input: ServerVoiceTranscriptionInput) => {
              captured.push(input);
              return Effect.succeed({ text: `Verified chunk ${captured.length}` });
            },
          }),
        listProviders: () => Effect.succeed(["codex"]),
      } as unknown as ProviderAdapterRegistryShape;
      try {
        const result = yield* executeVideoTool(f.scope, "djl_transcribe_video", {
          campaignId: f.campaign.id,
          assetId,
          start: 0.5,
          end: 6.5,
          chunkSeconds: 5,
        }).pipe(Effect.provideService(ProviderAdapterRegistry, registry));
        assert.equal(result.status, "complete");
        assert.lengthOf(captured, 2);
        for (const request of captured) {
          const wav = Buffer.from(request.audioBase64, "base64");
          assert.equal(wav.toString("ascii", 0, 4), "RIFF");
          assert.equal(wav.readUInt16LE(22), 1);
          assert.equal(wav.readUInt32LE(24), 24000);
          assert.isBelow(wav.length, 10 * 1024 * 1024);
          assert.isAtMost(request.durationMs, 120000);
        }
        const transcript = result.transcript as {
          id: string;
          timing: string;
          segments: { start: number; end: number; text: string }[];
        };
        assert.equal(transcript.timing, "audio-chunk");
        assert.deepEqual(transcript.segments, [
          { start: 0.5, end: 5.5, text: "Verified chunk 1" },
          { start: 5.5, end: 6.5, text: "Verified chunk 2" },
        ]);
        assert.isNotNull(
          yield* readDocument("agent-video-transcript", `${f.owner.key}:${transcript.id}`),
        );
        const render = yield* executeVideoTool(f.scope, "djl_repurpose_video", {
          action: "render",
          campaignId: f.campaign.id,
          version: 1,
          assetId,
          clips: [{ start: 0.5, end: 1.5, crop: "original" }],
          subtitleProvenance: "transcript",
          transcriptId: transcript.id,
        });
        assert.equal(render.status, "complete");
      } finally {
        yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect(
    "surfaces the fixed remote challenge blocker and actual status without login advice",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const blocked = new VoiceTranscriptionError(
          "browser-verification",
          403,
          "The transcription service requires browser verification (HTTP 403). Automatic transcription is unavailable with the current service. Retry later or supply timestamped subtitles.",
        );
        const remove = registerVideoTranscriber(f.root, () =>
          Effect.fail(
            new ProviderAdapterRequestError({
              provider: "codex",
              method: "transcribeVoice",
              detail: blocked.message,
              cause: blocked,
            }),
          ),
        );
        try {
          const error = yield* executeVideoTool(f.scope, "djl_transcribe_video", {
            campaignId: f.campaign.id,
            assetId,
          }).pipe(Effect.flip);
          assert.equal((error as { status: number }).status, 403);
          assert.include(String(error), "browser verification");
          assert.notInclude(String(error), "login");
          assert.include(String(error), "timestamped subtitles");
        } finally {
          remove();
          yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
        }
      }),
  );
  it.effect("uses only a live transcriber registered for the current server state directory", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      let calls = 0;
      const removeForeign = registerVideoTranscriber(`${f.root}-foreign`, () => {
        calls++;
        return Effect.succeed({ text: "Foreign" });
      });
      let remove: (() => void) | undefined;
      try {
        const blocked = yield* executeVideoTool(f.scope, "djl_transcribe_video", {
          campaignId: f.campaign.id,
          assetId,
        });
        assert.equal(blocked.status, "unavailable");
        assert.equal(calls, 0);
        remove = registerVideoTranscriber(f.root, () => {
          calls++;
          return Effect.succeed({ text: "Actual registered service response" });
        });
        const result = yield* executeVideoTool(f.scope, "djl_transcribe_video", {
          campaignId: f.campaign.id,
          assetId,
        });
        assert.equal(result.status, "complete");
        assert.equal(calls, 1);
        remove();
        assert.equal(
          (yield* executeVideoTool(f.scope, "djl_transcribe_video", {
            campaignId: f.campaign.id,
            assetId,
          })).status,
          "unavailable",
        );
      } finally {
        remove?.();
        removeForeign();
        yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect("recovers persisted interrupted jobs and denies foreign job lookup", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      try {
        const id = crypto.randomUUID();
        yield* saveDocument(
          "agent-video-job",
          `${f.owner.key}:${id}`,
          {
            id,
            ownerKey: f.owner.key,
            threadId: f.scope.threadId,
            campaignId: f.campaign.id,
            sourceAssetId: assetId,
            status: "rendering",
            clips: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          null,
        );
        const recovered = yield* executeVideoTool(f.scope, "djl_repurpose_video", {
          action: "get",
          jobId: id,
        });
        assert.equal(recovered.status, "interrupted");
        assert.equal(recovered.version, 2);
        assert.instanceOf(
          yield* executeVideoTool({ ...f.scope, threadId: "foreign" }, "djl_repurpose_video", {
            action: "get",
            jobId: id,
          }).pipe(Effect.flip),
          Error,
        );
        assert.instanceOf(
          yield* executeVideoTool(f.scope, "djl_repurpose_video", {
            action: "cancel",
            jobId: id,
          }).pipe(Effect.flip),
          Error,
        );
      } finally {
        yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
      }
    }),
  );
  it.effect("reports absent transcription service and FFmpeg explicitly", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const saved = process.env.DJL_FFMPEG_PATH;
      try {
        const result = yield* executeVideoTool(f.scope, "djl_transcribe_video", {
          campaignId: f.campaign.id,
          assetId,
        });
        assert.equal(result.status, "unavailable");
        assert.include(String(result.nextStep), "Codex");
        process.env.DJL_FFMPEG_PATH = "/no-such-ffmpeg";
        const error = yield* executeVideoTool(f.scope, "djl_repurpose_video", {
          action: "render",
          campaignId: f.campaign.id,
          version: 1,
          assetId,
          clips: [{ start: 0, end: 1, crop: "original" }],
        }).pipe(Effect.flip);
        assert.include(String(error), "FFmpeg");
        assert.equal((yield* readDocument("campaign", f.campaign.id))?.version, 1);
      } finally {
        if (saved === undefined) delete process.env.DJL_FFMPEG_PATH;
        else process.env.DJL_FFMPEG_PATH = saved;
        yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
      }
    }),
  );
});

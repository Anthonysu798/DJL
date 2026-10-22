import sharp from "sharp";
import { listMarketingModels, generateCampaignCopy } from "./generation";
import { recoverJobs, startExport, cancelExport, type ExportJob } from "./jobs";
import { saveImageRecipe, saveVideoTimeline } from "./revisions";
import { validateTimeline, type ResolvedClip } from "./video";
import { Effect, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  createCampaign,
  reviseCampaign,
  approveCampaign,
  confirmAssistedPublication,
  defaultBrand,
  defaultImageRecipe,
  type Campaign,
  type MediaAsset,
  type ImageRecipe,
  type BrandProfile,
} from "@synara/contracts";
import type { ServerConfigShape } from "../config";
import { collectBoundedStream } from "../streamingAttachmentUpload";
import { listDocuments, readDocument, saveDocument, MarketingError } from "./store";
import { inspectImage, inspectVideo, renderImage } from "./media";

const timelineSchema = Schema.Struct({
  campaignId: Schema.String,
  version: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  clips: Schema.Array(
    Schema.Struct({
      assetId: Schema.String,
      start: Schema.Number,
      end: Schema.Number,
      speed: Schema.Number,
    }),
  ),
});
const patchSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  brief: Schema.optional(Schema.String),
  assetIds: Schema.optional(Schema.Array(Schema.String)),
  platforms: Schema.optional(Schema.Array(Schema.String)),
  captions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const commandSchema = Schema.Struct({
  action: Schema.Literals(["create", "update", "approve", "confirm", "brand", "recipe"]),
  id: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number),
  name: Schema.optional(Schema.String),
  platform: Schema.optional(Schema.String),
  patch: Schema.optional(patchSchema),
  value: Schema.optional(Schema.Unknown),
});
const recipeSchema = Schema.Struct({
  exposure: Schema.Number,
  contrast: Schema.Number,
  saturation: Schema.Number,
  temperature: Schema.Number,
  rotation: Schema.Number,
  flip: Schema.Boolean,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
});
const brandSchema = Schema.Struct(
  Object.fromEntries(Object.keys(defaultBrand).map((k) => [k, Schema.String])) as Record<
    keyof typeof defaultBrand,
    typeof Schema.String
  >,
);
const attempt = <A>(body: () => Promise<A>) =>
  Effect.tryPromise({
    try: body,
    catch: (e) => new MarketingError(e instanceof Error ? e.message : "Media operation failed."),
  });
const json = (value: unknown) =>
  HttpServerResponse.jsonUnsafe(value, { headers: { "Cache-Control": "no-store" } });

export function marketingHandler(config: ServerConfigShape) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request)!;
    const operation = url.pathname.slice("/api/marketing/".length);
    const root = path.join(config.stateDir, "marketing", "originals");
    if (operation === "state" && request.method === "GET") {
      const campaigns = yield* listDocuments("campaign");
      const assets = yield* listDocuments("asset");
      const brand = yield* readDocument("brand", "default");
      const recipes = yield* listDocuments("recipe");
      const timelines = yield* listDocuments("timeline");
      const jobs = yield* recoverJobs();
      return json({
        campaigns,
        assets,
        brand: brand ?? { value: defaultBrand, version: 0 },
        recipes,
        timelines,
        jobs,
      });
    }
    if (operation === "models" && request.method === "GET")
      return json(yield* attempt(() => listMarketingModels(config.secretsDir)));
    if (operation === "generate" && request.method === "POST") {
      const bytes = yield* collectBoundedStream(request.stream, 1024 * 1024);
      const input = yield* Effect.try({
        try: () =>
          Schema.decodeUnknownSync(
            Schema.Struct({
              campaignId: Schema.String,
              version: Schema.Number,
              model: Schema.String,
              includeImages: Schema.Boolean,
              consent: Schema.Boolean,
            }),
          )(JSON.parse(new TextDecoder().decode(bytes))),
        catch: () => new MarketingError("Invalid generation request."),
      });
      if (!input.consent)
        return yield* Effect.fail(
          new MarketingError("Approve sending the brief and selected media to the model first."),
        );
      const record = yield* readDocument("campaign", input.campaignId);
      if (!record || record.version !== input.version)
        return yield* Effect.fail(
          new MarketingError("Campaign changed. Reload before generating.", 409),
        );
      const campaign = record.value as Campaign;
      const brand = yield* readDocument("brand", "default");
      const images: string[] = [];
      if (input.includeImages) {
        for (const id of campaign.assetIds.slice(0, 4)) {
          const asset = yield* readDocument("asset", id);
          if (asset && (asset.value as MediaAsset).mime.startsWith("image/")) {
            const image = yield* attempt(async () =>
              sharp(await readFile(path.join(root, id)), { limitInputPixels: 80000000 })
                .autoOrient()
                .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toBuffer(),
            );
            images.push(`data:image/jpeg;base64,${image.toString("base64")}`);
          }
        }
      }
      const captions = yield* attempt(() =>
        generateCampaignCopy({
          secretsDir: config.secretsDir,
          model: input.model,
          campaign,
          brand: (brand?.value as BrandProfile) ?? defaultBrand,
          images,
        }),
      );
      return json({ captions, revision: campaign.revision });
    }
    if (operation === "command" && request.method === "POST") {
      const bytes = yield* collectBoundedStream(request.stream, 1024 * 1024);
      const command = yield* Effect.try({
        try: () =>
          Schema.decodeUnknownSync(commandSchema)(JSON.parse(new TextDecoder().decode(bytes))),
        catch: () => new MarketingError("Invalid command."),
      });
      if (command.action === "create") {
        const campaign = yield* Effect.try({
          try: () => createCampaign(command.name ?? ""),
          catch: (e) => new MarketingError(String(e)),
        });
        return json(yield* saveDocument("campaign", campaign.id, campaign, null));
      }
      if (command.action === "brand") {
        const brand = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(brandSchema)(command.value),
          catch: () => new MarketingError("Invalid brand profile."),
        });
        if (Object.values(brand).some((v) => v.length > 20000))
          return yield* Effect.fail(new MarketingError("Brand field is too long."));
        return json(yield* saveDocument("brand", "default", brand, command.version || null));
      }
      if (command.action === "recipe") {
        if (!command.id || !(yield* readDocument("asset", command.id)))
          return yield* Effect.fail(new MarketingError("Media not found.", 404));
        const recipe = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(recipeSchema)(command.value),
          catch: () => new MarketingError("Invalid edit recipe."),
        });
        return json(yield* saveImageRecipe(command.id, recipe, command.version || null));
      }
      const record = yield* readDocument("campaign", command.id ?? "");
      if (!record) return yield* Effect.fail(new MarketingError("Campaign not found.", 404));
      if (record.version !== command.version)
        return yield* Effect.fail(
          new MarketingError("Campaign changed. Reload before saving.", 409),
        );
      const campaign = record.value as Campaign;
      if (command.action === "update" && command.patch?.assetIds) {
        for (const id of command.patch.assetIds)
          if (!(yield* readDocument("asset", id)))
            return yield* Effect.fail(new MarketingError("A selected asset is missing."));
      }
      const updated = yield* Effect.try({
        try: () => {
          if (command.action === "update")
            return reviseCampaign(campaign, {
              name: command.patch?.name ?? campaign.name,
              brief: command.patch?.brief ?? campaign.brief,
              captions: command.patch?.captions ?? campaign.captions,
              assetIds: command.patch?.assetIds ? [...command.patch.assetIds] : campaign.assetIds,
              platforms: command.patch?.platforms
                ? [...command.patch.platforms]
                : campaign.platforms,
            });
          if (command.action === "approve") return approveCampaign(campaign, campaign.revision);
          return confirmAssistedPublication(campaign, command.platform ?? "");
        },
        catch: (e) => new MarketingError(String(e)),
      });
      return json(yield* saveDocument("campaign", campaign.id, updated, record.version));
    }
    if (operation === "import" && request.method === "POST") {
      const bytes = yield* collectBoundedStream(request.stream, 256 * 1024 * 1024);
      if (!bytes.length) return yield* Effect.fail(new MarketingError("The file is empty."));
      const id = crypto.randomUUID();
      const filename = yield* Effect.try({
        try: () =>
          decodeURIComponent(request.headers["x-djl-filename"] ?? "Media")
            .split("")
            .filter((character) => character.charCodeAt(0) >= 32)
            .join("")
            .slice(0, 200),
        catch: () => new MarketingError("Invalid filename."),
      });
      yield* attempt(() => mkdir(root, { recursive: true }));
      const target = path.join(root, id);
      yield* attempt(() => writeFile(target, bytes, { flag: "wx", mode: 0o600 }));
      const metadata = yield* attempt(async () => {
        try {
          return await inspectImage(bytes);
        } catch {
          // Only accept known video container signatures, never playlists or URL-bearing inputs.
          const b = Buffer.from(bytes);
          const mp4 = b.subarray(4, 8).toString() === "ftyp";
          const webm = b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
          if (!mp4 && !webm)
            throw new Error(
              "Unsupported or damaged media. Import JPEG, PNG, WebP, TIFF, HEIC, AVIF, MP4/MOV, or WebM.",
            );
          return { ...(await inspectVideo(target)), mime: mp4 ? "video/mp4" : "video/webm" };
        }
      }).pipe(
        Effect.catch((e) => attempt(() => unlink(target)).pipe(Effect.andThen(Effect.fail(e)))),
      );
      const asset: MediaAsset = {
        id,
        name: filename,
        bytes: bytes.length,
        createdAt: new Date().toISOString(),
        ...metadata,
      };
      return json(yield* saveDocument("asset", id, asset, null));
    }
    if ((operation === "timeline" || operation === "video-export") && request.method === "POST") {
      const bytes = yield* collectBoundedStream(request.stream, 1024 * 1024);
      const input = yield* Effect.try({
        try: () =>
          Schema.decodeUnknownSync(timelineSchema)(JSON.parse(new TextDecoder().decode(bytes))),
        catch: () => new MarketingError("Invalid timeline."),
      });
      if (!(yield* readDocument("campaign", input.campaignId)))
        return yield* Effect.fail(new MarketingError("Select a campaign.", 404));
      const clips: ResolvedClip[] = [];
      for (const clip of input.clips) {
        const record = yield* readDocument("asset", clip.assetId);
        if (!record || !(record.value as MediaAsset).mime.startsWith("video/"))
          return yield* Effect.fail(new MarketingError("Video asset not found.", 404));
        const source = path.join(root, clip.assetId);
        const meta = yield* attempt(() => inspectVideo(source));
        clips.push({ ...clip, ...meta, path: source });
      }
      yield* Effect.try({
        try: () => validateTimeline(clips),
        catch: (e) => new MarketingError(String(e)),
      });
      if (operation === "timeline")
        return json(yield* saveVideoTimeline(input.campaignId, input, input.version || null));
      return json(
        yield* startExport(
          path.join(config.stateDir, "marketing"),
          input.campaignId,
          clips,
          input.width,
          input.height,
        ),
      );
    }
    const jobMatch = /^job\/([a-f0-9-]{36})(\/cancel)?$/.exec(operation);
    if (jobMatch) {
      const record = yield* readDocument("job", jobMatch[1]!);
      if (!record) return yield* Effect.fail(new MarketingError("Export not found.", 404));
      const job = record.value as ExportJob;
      if (request.method === "POST" && jobMatch[2]) {
        yield* Effect.try({
          try: () => cancelExport(job.id),
          catch: (e) =>
            e instanceof MarketingError ? e : new MarketingError("Cannot cancel export."),
        });
        return json({ canceled: true });
      }
      if (request.method === "GET" && !jobMatch[2]) {
        if (job.status !== "complete")
          return yield* Effect.fail(new MarketingError("Export is not complete.", 409));
        const bytes = yield* attempt(() =>
          readFile(path.join(config.stateDir, "marketing", `${job.id}.mp4`)),
        );
        return HttpServerResponse.uint8Array(bytes, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Disposition": 'attachment; filename="campaign.mp4"',
          },
        });
      }
    }
    const match = /^(asset|render)\/([a-f0-9-]{36})$/.exec(operation);
    if (match && request.method === "GET") {
      const record = yield* readDocument("asset", match[2]!);
      if (!record) return yield* Effect.fail(new MarketingError("Media not found.", 404));
      const asset = record.value as MediaAsset;
      const bytes = yield* attempt(() => readFile(path.join(root, asset.id)));
      let output: Uint8Array = bytes;
      if (match[1] === "render") {
        if (!asset.mime.startsWith("image/"))
          return yield* Effect.fail(new MarketingError("Select an image."));
        const saved = yield* readDocument("recipe", asset.id);
        output = yield* attempt(() =>
          renderImage(
            bytes,
            saved ? (saved.value as { recipe: ImageRecipe }).recipe : defaultImageRecipe,
          ),
        );
      }
      return HttpServerResponse.uint8Array(output, {
        headers: {
          "Content-Type": match[1] === "render" ? "image/png" : asset.mime,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...(url.searchParams.has("download")
            ? {
                "Content-Disposition": `attachment; filename="${asset.id}.${match[1] === "render" ? "png" : asset.mime.split("/")[1]}"`,
              }
            : {}),
        },
      });
    }
    return HttpServerResponse.text("Not found", { status: 404 });
  }).pipe(
    Effect.catch((e) =>
      Effect.succeed(
        HttpServerResponse.text(
          e instanceof MarketingError ? e.message : "Marketing operation failed. Please retry.",
          { status: e instanceof MarketingError ? e.status : 500 },
        ),
      ),
    ),
  );
}

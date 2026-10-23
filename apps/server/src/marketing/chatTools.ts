import { Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  createCampaign,
  reviseCampaign,
  defaultImageRecipe,
  type Campaign,
  type MediaAsset,
} from "@synara/contracts";
import { readDocument, saveDocument, MarketingError } from "./store";
import { inspectImage, inspectVideo, renderImage } from "./media";
import { saveImageRecipe } from "./revisions";
import { resolveAuthorizedInputPath } from "../work/documentTools";

export interface MarketingToolScope {
  threadId: string;
  authorizedRoot: string;
  attachmentFiles: string[];
  stateDir: string;
}
export type MarketingToolHandler = (
  scope: { threadId: string; authorizedRoot: string; attachmentFiles: string[] },
  name: string,
  args: unknown,
) => Promise<Record<string, unknown>>;
export const MARKETING_TOOLS = [
  {
    name: "djl_marketing_status",
    description:
      "Read this conversation’s marketing campaign, saved brand facts and available attached media before preparing or revising a campaign. Never publishes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      title: "Read campaign context",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "read" as const },
  },
  {
    name: "djl_prepare_marketing",
    description:
      "Prepare or revise a real marketing campaign from the user’s request. Write separate captions yourself using the current conversation and brand facts; import attached images/videos automatically; optionally apply requested light/color corrections. Creates an interactive preview/approval card in this chat. Never approves or publishes. Call status first; when updating supply campaignId and version. Do not invent offers, prices or testimonials. Ask only for missing essential facts. Use imageAdjustments only if the user requested editing.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        version: { type: "integer" },
        name: { type: "string" },
        brief: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        captions: { type: "object", additionalProperties: { type: "string" } },
        mediaPaths: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional authorized paths. Omit to use this conversation’s attached images/videos.",
        },
        imageAdjustments: {
          type: "object",
          properties: {
            exposure: { type: "number", minimum: -3, maximum: 3 },
            contrast: { type: "number", minimum: 0, maximum: 3 },
            saturation: { type: "number", minimum: 0, maximum: 3 },
            temperature: { type: "number", minimum: -1, maximum: 1 },
          },
          additionalProperties: false,
        },
      },
      required: ["name", "platforms", "captions"],
      additionalProperties: false,
    },
    annotations: {
      title: "Prepare marketing preview",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    _meta: { "djl/tool-classification": "modify-copy" as const },
  },
];
const prepareSchema = Schema.Struct({
  campaignId: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number),
  name: Schema.String,
  brief: Schema.optional(Schema.String),
  platforms: Schema.Array(Schema.String),
  captions: Schema.Record(Schema.String, Schema.String),
  mediaPaths: Schema.optional(Schema.Array(Schema.String)),
  imageAdjustments: Schema.optional(
    Schema.Struct({
      exposure: Schema.optional(Schema.Number),
      contrast: Schema.optional(Schema.Number),
      saturation: Schema.optional(Schema.Number),
      temperature: Schema.optional(Schema.Number),
    }),
  ),
});
const attempt = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) =>
      new MarketingError(e instanceof Error ? e.message : "Campaign preparation failed."),
  });
export function listThreadCampaigns(threadId: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      body: string;
      version: number;
    }>`SELECT body,version FROM marketing_documents WHERE kind='campaign' AND json_extract(body,'$.threadId')=${threadId} ORDER BY updated_at DESC`;
    return rows.map((row) => ({ value: JSON.parse(row.body) as Campaign, version: row.version }));
  });
}
function executeMarketingToolUnchecked(
  scope: MarketingToolScope,
  name: string,
  raw: unknown,
): Effect.Effect<Record<string, unknown>, unknown, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    if (name === "djl_marketing_status")
      return {
        campaigns: yield* listThreadCampaigns(scope.threadId),
        brand: (yield* readDocument("brand", "default"))?.value ?? null,
        attachments: scope.attachmentFiles.map((p) => `Attachments/${path.basename(p)}`),
        publishing:
          "Assisted only. Prepare previews in chat; the user approves and completes publication. Never report automatic posting.",
      };
    if (name !== "djl_prepare_marketing")
      return yield* Effect.fail(new MarketingError("Unknown marketing tool."));
    const input = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(prepareSchema)(raw),
      catch: () => new MarketingError("Invalid campaign input."),
    });
    const prior = input.campaignId ? yield* readDocument("campaign", input.campaignId) : null;
    if (input.campaignId && (!prior || (prior.value as Campaign).threadId !== scope.threadId))
      return yield* Effect.fail(
        new MarketingError("Campaign belongs to another conversation or is missing.", 404),
      );
    if (prior && prior.version !== input.version)
      return yield* Effect.fail(
        new MarketingError("Campaign changed. Call djl_marketing_status before updating.", 409),
      );
    const existing = prior?.value as Campaign | undefined;
    // Validate content before importing any media; unsupported platforms must not leave a draft behind.
    let campaign = yield* Effect.try({
      try: () =>
        reviseCampaign(existing ?? { ...createCampaign(input.name), threadId: scope.threadId }, {
          name: input.name,
          brief: input.brief ?? existing?.brief ?? "",
          platforms: [...input.platforms],
          captions: { ...input.captions },
        }),
      catch: (e) => new MarketingError(String(e)),
    });
    const requested =
      input.mediaPaths ??
      scope.attachmentFiles.filter((p) =>
        /\.(jpe?g|png|webp|tiff?|heic|avif|mp4|mov|webm)$/i.test(p),
      );
    if (requested.length > 24)
      return yield* Effect.fail(new MarketingError("Use at most 24 media files per campaign."));
    const root = path.join(scope.stateDir, "marketing", "originals");
    const ids = new Set(campaign.assetIds);
    for (const requestedPath of requested) {
      const alias = scope.attachmentFiles.find(
        (p) => `Attachments/${path.basename(p)}` === requestedPath,
      );
      const source = yield* attempt(() =>
        resolveAuthorizedInputPath(
          scope.authorizedRoot,
          alias ?? requestedPath,
          scope.attachmentFiles,
        ),
      );
      const size = yield* attempt(() => stat(source));
      if (size.size > 256 * 1024 * 1024 || !size.isFile())
        return yield* Effect.fail(
          new MarketingError("Media must be a file no larger than 256 MB."),
        );
      const bytes = yield* attempt(() => readFile(source));
      const hash = createHash("sha256")
        .update(scope.threadId)
        .update(bytes)
        .digest("hex")
        .slice(0, 32);
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
      if (!(yield* readDocument("asset", id))) {
        const metadata = yield* attempt(async () => {
          try {
            return await inspectImage(bytes);
          } catch {
            const mp4 = bytes.subarray(4, 8).toString() === "ftyp";
            const webm = bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
            if (!mp4 && !webm) throw new Error("Unsupported or damaged media.");
            return { ...(await inspectVideo(source)), mime: mp4 ? "video/mp4" : "video/webm" };
          }
        });
        yield* attempt(() => mkdir(root, { recursive: true }));
        yield* attempt(() =>
          writeFile(path.join(root, id), bytes, { flag: "wx", mode: 0o600 }).catch((e) => {
            if (e.code !== "EEXIST") throw e;
          }),
        );
        const asset: MediaAsset = {
          id,
          name: path.basename(source),
          bytes: bytes.length,
          createdAt: new Date().toISOString(),
          ...metadata,
        };
        yield* saveDocument("asset", id, asset, null);
      }
      ids.add(id);
      const asset = (yield* readDocument("asset", id))!.value as MediaAsset;
      if (input.imageAdjustments && asset.mime.startsWith("image/")) {
        const previous = yield* readDocument("recipe", id);
        const recipe = {
          ...defaultImageRecipe,
          exposure: input.imageAdjustments.exposure ?? 0,
          contrast: input.imageAdjustments.contrast ?? 1,
          saturation: input.imageAdjustments.saturation ?? 1,
          temperature: input.imageAdjustments.temperature ?? 0,
        };
        yield* attempt(() => renderImage(bytes, recipe));
        yield* saveImageRecipe(id, recipe, previous?.version ?? null);
      }
    }
    // Image edits may have advanced the same campaign; use the latest version only for our own changes.
    const current =
      existing && input.imageAdjustments ? yield* readDocument("campaign", existing.id) : prior;
    campaign = {
      ...campaign,
      assetIds: [...ids],
      revision: Math.max(
        campaign.revision,
        ((current?.value as Campaign | undefined)?.revision ?? 0) + 1,
      ),
      approvedRevision: null,
    };
    const saved = yield* saveDocument("campaign", campaign.id, campaign, current?.version ?? null);
    return {
      campaignId: campaign.id,
      version: saved.version,
      revision: campaign.revision,
      assetCount: campaign.assetIds.length,
      platforms: campaign.platforms,
      card: "marketing-review",
      message:
        "Prepared in this conversation. Ask the user to review the card. Nothing has been published.",
    };
  });
}

export function executeMarketingTool(scope: MarketingToolScope, name: string, args: unknown) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(executeMarketingToolUnchecked(scope, name, args));
  });
}

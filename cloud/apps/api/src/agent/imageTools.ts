/**
 * generate_image and edit_image. Both go through the gateway (credits,
 * windows, refunds) and save every result as the user's own file (source
 * `generated`) in the blob store; the reply references it with an image_ref
 * part. Image bytes never appear in run events or tool results.
 */
import { schema, type DjlDatabase } from "@djl/db";
import type { CloudImageRefPart } from "@synara/contracts/cloud";

import { bytesMatchType } from "../files/fileTypes.ts";
import { storageKey } from "../files/FileService.ts";
import type { GatewayService } from "../gateway/GatewayService.ts";
import { safeFetch } from "../net/safeFetch.ts";
import type { RunRow } from "../runs/wire.ts";
import type { BlobStore } from "../sync/BlobStore.ts";
import { ToolError, type AgentTool, type ToolOutput } from "./tools.ts";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

function detectType(bytes: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
  return IMAGE_TYPES.find((t) => bytesMatchType(t, bytes)) ?? null;
}

/** Width and height from a PNG header; null for other formats. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!bytesMatchType("image/png", bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes as BufferSource)).toString("hex");
}

/** Stores generated image bytes as a ready file owned by the run's user. */
export async function saveGeneratedImage(
  deps: { readonly db: DjlDatabase; readonly blobs: BlobStore },
  run: RunRow,
  bytes: Uint8Array,
): Promise<CloudImageRefPart> {
  const mimeType = detectType(bytes);
  if (!mimeType) throw new ToolError("The image provider returned an unsupported image.");
  const id = crypto.randomUUID();
  const key = storageKey(run.orgId, id);
  await deps.blobs.write(key, bytes, mimeType);
  const size = pngSize(bytes);
  await deps.db.insert(schema.files).values({
    id,
    orgId: run.orgId,
    userId: run.userId,
    name: `image-${id.slice(0, 8)}.${mimeType.split("/")[1]}`,
    mimeType,
    sizeBytes: bytes.byteLength,
    storageKey: key,
    status: "ready",
    source: "generated",
    purpose: "image",
    sha256: await sha256Hex(bytes),
    width: size?.width ?? null,
    height: size?.height ?? null,
    completedAt: new Date(),
  });
  return {
    type: "image_ref",
    fileId: id as CloudImageRefPart["fileId"],
    mimeType,
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}

async function imageBytes(
  image: { readonly b64_json?: string; readonly url?: string },
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (image.b64_json) return new Uint8Array(Buffer.from(image.b64_json, "base64"));
  if (image.url) {
    const response = await safeFetch(image.url, {
      signal,
      contentTypes: IMAGE_TYPES,
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: 30_000,
    });
    return response.body;
  }
  throw new ToolError("The image provider returned no image.");
}

export function createImageTools(deps: {
  readonly db: DjlDatabase;
  readonly blobs: BlobStore;
  readonly gateway: Pick<GatewayService, "generateImage" | "editImage">;
}): AgentTool[] {
  const saved = async (
    run: RunRow,
    data: readonly { readonly b64_json?: string; readonly url?: string }[],
    signal: AbortSignal,
    verb: string,
  ): Promise<ToolOutput> => {
    const parts: CloudImageRefPart[] = [];
    for (const image of data)
      parts.push(await saveGeneratedImage(deps, run, await imageBytes(image, signal)));
    return {
      content: `${verb} ${parts.length} image(s), shown to the user: ${parts.map((p) => `file_id ${p.fileId}`).join(", ")}.`,
      parts,
    };
  };

  const generate: AgentTool = {
    name: "generate_image",
    description: "Create an image from a text description. The image is shown to the user.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A detailed description of the image.",
          maxLength: 4000,
        },
        size: {
          type: "string",
          description: "Image size.",
          enum: ["1024x1024", "1536x1024", "1024x1536"],
        },
      },
      required: ["prompt", "size"],
      additionalProperties: false,
    },
    quota: 4,
    async run(args, ctx) {
      const result = await deps.gateway.generateImage(
        ctx.facts,
        { model: "image.generate", prompt: String(args.prompt), n: 1, size: String(args.size) },
        { signal: ctx.signal },
      );
      return saved(ctx.run, result.data, ctx.signal, "Generated");
    },
  };

  const edit: AgentTool = {
    name: "edit_image",
    description:
      "Edit an image from this conversation (one the user attached or one you generated) following an instruction.",
    parameters: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "The image's file_id.", maxLength: 64 },
        prompt: { type: "string", description: "What to change.", maxLength: 4000 },
      },
      required: ["file_id", "prompt"],
      additionalProperties: false,
    },
    quota: 4,
    async run(args, ctx) {
      const file = await ctx.file(String(args.file_id));
      if (!file || !(IMAGE_TYPES as readonly string[]).includes(file.mimeType))
        throw new ToolError("No PNG, JPEG, or WebP image with that file_id in this conversation.");
      const bytes = await deps.blobs.read(file.storageKey);
      if (!bytes) throw new ToolError("That image is no longer available.");
      const result = await ctx.charge("image_edit", 1, async () => ({
        value: await deps.gateway.editImage(
          ctx.facts,
          {
            model: "image.edit",
            prompt: String(args.prompt),
            image: { bytes, mimeType: file.mimeType },
          },
          { signal: ctx.signal },
        ),
        units: 1,
      }));
      return saved(ctx.run, result.data, ctx.signal, "Edited");
    },
  };

  return [generate, edit];
}

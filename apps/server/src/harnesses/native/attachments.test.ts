import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { modelImages } from "./attachments";

describe("modelImages", () => {
  const dir = mkdtempSync(join(tmpdir(), "djl-model-images-"));
  const file = (name: string, mimeType: string, bytes: Buffer | string, image = true) => {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return { path, name, mimeType, sizeBytes: Buffer.byteLength(bytes), image };
  };

  it("passes a small supported image through and skips files that are not images", async () => {
    expect(
      await modelImages([
        file("a.png", "image/png", "png"),
        file("notes.txt", "text/plain", "notes", false),
      ]),
    ).toEqual([{ data: Buffer.from("png").toString("base64"), mimeType: "image/png" }]);
  });

  it("scales down and re-encodes an image the model APIs would refuse", async () => {
    const tiff = await sharp({
      create: { width: 3000, height: 20, channels: 3, background: "#c00" },
    })
      .tiff()
      .toBuffer();
    const [image] = await modelImages([file("wide.tiff", "image/tiff", tiff)]);
    expect(image!.mimeType).toBe("image/webp");
    const decoded = await sharp(Buffer.from(image!.data, "base64")).metadata();
    expect([decoded.format, decoded.width]).toEqual(["webp", 2000]);
  });

  it("leaves out an image it cannot decode rather than failing the turn", async () => {
    expect(await modelImages([file("broken.heic", "image/heic", "not an image")])).toEqual([]);
  });
});

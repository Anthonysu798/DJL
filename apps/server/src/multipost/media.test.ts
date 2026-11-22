import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { attachmentIdForContentHash } from "../streamingAttachmentUpload";
import sharp from "sharp";
import { cropBox, cropMedia, importMultiPostMedia } from "./media";
it("imports only this conversation's attachments, preserving bytes and stable references", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "multipost-media-"));
  const attachments = path.join(root, "attachments");
  const workspace = path.join(root, "project");
  const mediaRoot = path.join(root, "media");
  await Promise.all([mkdir(attachments), mkdir(workspace)]);
  try {
    const own = attachmentIdForContentHash("chat-a", "a".repeat(64)) + ".png";
    const foreign = attachmentIdForContentHash("chat-b", "b".repeat(64)) + ".png";
    const bytes = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    await writeFile(path.join(attachments, own), bytes);
    await writeFile(path.join(attachments, foreign), bytes);
    const scope = {
      workspaceId: "w",
      threadId: "chat-a",
      authorizedRoot: workspace,
      attachmentsRoot: attachments,
      mediaRoot,
    };
    const first = await importMultiPostMedia(scope, [`Attachments/${own}`]);
    const second = await importMultiPostMedia(scope, [`Attachments/${own}`]);
    expect(first[0]?.url).toBe(second[0]?.url);
    expect(await readFile(path.join(mediaRoot, first[0]!.url.slice(6)))).toEqual(bytes);
    await expect(importMultiPostMedia(scope, [`Attachments/${foreign}`])).rejects.toThrow();
    await writeFile(path.join(workspace, ".env"), "private fixture");
    await expect(importMultiPostMedia(scope, [".env"])).rejects.toThrow(/media|supported/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("finds the part of a photo that fits a shape, around the chosen point", () => {
  expect(cropBox(400, 200, 1)).toEqual({ left: 100, top: 0, width: 200, height: 200 });
  expect(cropBox(400, 200, 1, { x: 0, y: 0.5 })).toEqual({
    left: 0,
    top: 0,
    width: 200,
    height: 200,
  });
  expect(cropBox(200, 500, 1, { x: 0.5, y: 1 })).toEqual({
    left: 0,
    top: 300,
    width: 200,
    height: 200,
  });
  expect(cropBox(400, 200, 1, { x: 7, y: Number.NaN })).toEqual({
    left: 200,
    top: 0,
    width: 200,
    height: 200,
  });
  expect(cropBox(300, 301, 1)).toBeNull();
});

it("crops a stored photo to a platform's shape and keeps the original untouched", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "multipost-crop-"));
  const mediaRoot = path.join(root, "media");
  const scope = { workspaceId: "w", threadId: "t", authorizedRoot: root, mediaRoot };
  try {
    // Left half red, right half blue.
    const wide = await sharp({
      create: { width: 400, height: 200, channels: 3, background: "#ff0000" },
    })
      .composite([
        {
          input: { create: { width: 200, height: 200, channels: 3, background: "#0000ff" } },
          left: 200,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    await writeFile(path.join(root, "wide.png"), wide);
    const [file] = await importMultiPostMedia(scope, ["wide.png"]);
    const left = await cropMedia(scope, { ...file!, focus: { x: 0, y: 0.5 } }, 1);
    expect(left).toMatchObject({ name: "wide.png", type: "image/png" });
    expect(left.url).not.toBe(file!.url);
    const bytes = await readFile(path.join(mediaRoot, left.url.slice(6)));
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([200, 200]);
    expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]);
    expect(left.size).toBe(bytes.length);
    expect(await readFile(path.join(mediaRoot, file!.url.slice(6)))).toEqual(wide);

    const square = await cropMedia(scope, left, 1);
    expect(square).toBe(left);
    const elsewhere = { name: "a.png", type: "image/png", url: "https://example.com/a.png" };
    expect(await cropMedia(scope, elsewhere, 1)).toBe(elsewhere);
    const broken = {
      name: "b.png",
      type: "image/png",
      url: `Media/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`,
    };
    expect(await cropMedia(scope, broken, 1)).toBe(broken);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

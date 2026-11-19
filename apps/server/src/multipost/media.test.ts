import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { attachmentIdForContentHash } from "../streamingAttachmentUpload";
import { importMultiPostMedia } from "./media";
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

import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { inspectSocialMedia, mediaEvidenceMcpResult } from "./mediaEvidence";

describe("social media evidence", () => {
  it("provides real image evidence as MCP image blocks, without base64 in text or structured output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "djl-visual-"));
    try {
      const file = path.join(root, "product.png");
      await writeFile(
        file,
        await sharp({ create: { width: 80, height: 40, channels: 3, background: "#1677aa" } })
          .png()
          .toBuffer(),
      );
      const evidence = await inspectSocialMedia(
        { threadId: "a", stateDir: root, authorizedRoot: root, attachmentFiles: [file] },
        { mediaPaths: ["Attachments/product.png"] },
      );
      expect(evidence.media[0]).toMatchObject({ kind: "image", width: 80, height: 40 });
      const result = mediaEvidenceMcpResult(evidence);
      expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
      expect(JSON.stringify(result.structuredContent)).not.toContain(
        evidence.visualSamples[0]!.data,
      );
      expect(result.content[0]).not.toHaveProperty("data");
      expect(
        (await sharp(Buffer.from(evidence.visualSamples[0]!.data, "base64")).metadata()).format,
      ).toBe("jpeg");
      await expect(
        inspectSocialMedia(
          { threadId: "a", stateDir: root, authorizedRoot: root, attachmentFiles: [] },
          { mediaPaths: ["/etc/hosts"] },
        ),
      ).rejects.toThrow();
      await expect(
        inspectSocialMedia(
          { threadId: "a", stateDir: root, authorizedRoot: root, attachmentFiles: [] },
          {},
        ),
      ).rejects.toThrow(/Choose/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("decodes bounded video samples and states the audio/coverage limits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "djl-video-visual-"));
    try {
      const file = path.join(root, "clip.mp4");
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x240:rate=10",
        "-t",
        "1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        file,
      ]);
      const evidence = await inspectSocialMedia(
        { threadId: "a", stateDir: root, authorizedRoot: root, attachmentFiles: [file] },
        {},
      );
      expect(evidence.media[0]).toMatchObject({
        kind: "video",
        width: 160,
        height: 240,
        duration: 1,
      });
      expect(evidence.visualSamples).toHaveLength(3);
      expect(evidence.visualSamples[0]!.label).toContain("0.10 seconds");
      expect(evidence.visualSamples[2]!.label).toContain("0.90 seconds");
      expect(evidence.limitations).toContain("Audio has not been transcribed");
      expect(evidence.limitations).toContain("Frames do not cover every moment");
      await writeFile(path.join(root, "broken.mp4"), "not a video");
      await expect(
        inspectSocialMedia(
          { threadId: "a", stateDir: root, authorizedRoot: root, attachmentFiles: [] },
          { mediaPaths: [path.join(root, "broken.mp4")] },
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("samples real extensionless owned videos using internal video classification", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "djl-owned-video-visual-"));
    try {
      const originals = path.join(root, "marketing", "originals");
      await mkdir(originals, { recursive: true });
      const file = path.join(originals, crypto.randomUUID());
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x240:rate=10",
        "-t",
        "1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "mp4",
        file,
      ]);
      const evidence = await inspectSocialMedia(
        {
          threadId: "owned-chat",
          stateDir: root,
          authorizedRoot: originals,
          attachmentFiles: [file],
        },
        { mediaPaths: [file], videoPaths: [file] },
      );
      expect(evidence.media[0]).toMatchObject({
        kind: "video",
        width: 160,
        height: 240,
        duration: 1,
      });
      expect(evidence.visualSamples).toHaveLength(3);
      for (const sample of evidence.visualSamples) {
        expect((await sharp(Buffer.from(sample.data, "base64")).metadata()).format).toBe("jpeg");
      }
      expect(evidence.visualSamples[0]!.label).toContain("0.10 seconds");
      expect(evidence.visualSamples[2]!.label).toContain("0.90 seconds");
      await expect(
        inspectSocialMedia(
          {
            threadId: "owned-chat",
            stateDir: root,
            authorizedRoot: originals,
            attachmentFiles: [],
          },
          { mediaPaths: ["/etc/hosts"], videoPaths: ["/etc/hosts"] },
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

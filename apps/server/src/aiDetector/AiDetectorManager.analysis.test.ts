import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AiDetectorState } from "@synara/contracts";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeFixture = vi.hoisted(() => {
  let releaseScore: (() => void) | undefined;
  let scoreStarted: (() => void) | undefined;
  let scoreGate = Promise.resolve();
  let scoreStartedGate = Promise.resolve();
  return {
    counted: [] as number[],
    scored: [] as number[],
    removed: 0,
    reset() {
      this.counted.length = 0;
      this.scored.length = 0;
      this.removed = 0;
      scoreGate = Promise.resolve();
      scoreStartedGate = Promise.resolve();
    },
    blockScore() {
      scoreGate = new Promise<void>((resolve) => {
        releaseScore = resolve;
      });
      scoreStartedGate = new Promise<void>((resolve) => {
        scoreStarted = resolve;
      });
    },
    releaseScore() {
      releaseScore?.();
    },
    waitForScore() {
      return scoreStartedGate;
    },
    async waitInScore() {
      scoreStarted?.();
      await scoreGate;
    },
  };
});

vi.mock("./modelInstaller", async (importOriginal) => {
  const original = await importOriginal<typeof import("./modelInstaller")>();
  return {
    ...original,
    inspectInstalledModel: async () => true,
    removeDetectorModel: async () => {
      runtimeFixture.removed += 1;
    },
  };
});

vi.mock("./modelRuntime", () => ({
  DetectorModelIntegrityError: class DetectorModelIntegrityError extends Error {},
  DetectorModelRuntime: class DetectorModelRuntime {
    async countTokens(_language: string, text: string): Promise<number> {
      runtimeFixture.counted.push(text.length);
      return text.length + 2;
    }

    async score(_language: string, text: string): Promise<number> {
      runtimeFixture.scored.push(text.length);
      await runtimeFixture.waitInScore();
      if (text.length + 2 > 500) throw new Error("passage was truncated by the model");
      return 0.9;
    }

    async dispose(): Promise<void> {}
  },
}));

import { AiDetectorManager } from "./AiDetectorManager";

describe("AiDetectorManager token-aware analysis", () => {
  beforeEach(() => runtimeFixture.reset());

  it("never assigns a score to characters beyond the model token limit", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-analysis-"));
    const manager = new AiDetectorManager(stateDir);
    const text = `${"word ".repeat(500)}\n`;

    const report = await manager.analyze({
      bytes: new TextEncoder().encode(text),
      filename: "sample.txt",
      mediaType: "text/plain",
      languagePreference: "en",
      signal: new AbortController().signal,
      emit: () => undefined,
    });

    expect(report.eligibleCharacters).toBeGreaterThan(0);
    expect(runtimeFixture.counted.length).toBeGreaterThan(0);
    expect(runtimeFixture.scored.length).toBeGreaterThan(1);
    expect(runtimeFixture.scored.every((length) => length + 2 <= 500)).toBe(true);
  });

  it("waits for active analysis before removing its model files", async () => {
    runtimeFixture.blockScore();
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-analysis-"));
    const manager = new AiDetectorManager(stateDir);
    const analysis = manager.analyze({
      bytes: new TextEncoder().encode(
        "This is a sufficiently long English paragraph for a model-removal concurrency test. ".repeat(
          4,
        ),
      ),
      filename: "sample.txt",
      mediaType: "text/plain",
      languagePreference: "en",
      signal: new AbortController().signal,
      emit: () => undefined,
    });
    await runtimeFixture.waitForScore();

    const removal = manager.removeModel("en");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtimeFixture.removed).toBe(0);

    runtimeFixture.releaseScore();
    await analysis;
    await removal;
    expect(runtimeFixture.removed).toBe(1);
  });

  it("recomputes document-specific extraction warnings on a content cache hit", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-analysis-"));
    const manager = new AiDetectorManager(stateDir);
    const text =
      "This sufficiently long English paragraph has identical text in a TXT and DOCX document so cache behavior can be verified safely. ".repeat(
        2,
      );
    const input = {
      languagePreference: "en" as const,
      signal: new AbortController().signal,
      emit: () => undefined,
    };
    const first = await manager.analyze({
      ...input,
      bytes: new TextEncoder().encode(text),
      filename: "sample.txt",
      mediaType: "text/plain",
    });
    expect(first.warnings).not.toContain("external-relationships-ignored");

    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>',
    );
    const second = await manager.analyze({
      ...input,
      bytes: await zip.generateAsync({ type: "uint8array", compression: "STORE" }),
      filename: "sample.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(second.cacheHit).toBe(true);
    expect(second.warnings).toContain("external-relationships-ignored");
  });

  it("publishes the updated cache status after a successful analysis", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-analysis-"));
    const updates: AiDetectorState[] = [];
    const manager = new AiDetectorManager(stateDir, (state) => {
      updates.push(state);
    });

    await manager.analyze({
      bytes: new TextEncoder().encode(
        "This sufficiently long English paragraph verifies that the visible cache count updates immediately after a completed local writing analysis. ".repeat(
          2,
        ),
      ),
      filename: "cache-status.txt",
      mediaType: "text/plain",
      languagePreference: "en",
      signal: new AbortController().signal,
      emit: () => undefined,
    });

    expect(updates.at(-1)).toMatchObject({ cacheEntries: 1 });
  });
});

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AiDetectorReport } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { DetectorResultCache } from "./resultCache";

function makeReport(text: string): AiDetectorReport {
  return {
    schemaVersion: 1,
    normalizedText: text,
    languagePreference: "auto",
    scores: { likelyAi: 20, uncertain: 30, likelyHuman: 50 },
    assessment: "mixed",
    confidence: "medium",
    eligibleCharacters: text.length,
    excludedCharacters: 0,
    totalCharacters: text.length,
    regions: [{ start: 0, end: text.length, label: "uncertain", language: "en", score: 0.5 }],
    modelRuns: [],
    preprocessingVersion: "test-preprocessing",
    segmentationVersion: "test-segmentation",
    contentHash: createHash("sha256").update(text).digest("hex"),
    cacheHit: false,
    warnings: [],
  };
}

describe("DetectorResultCache", () => {
  it("persists only hashes and derived results, never submitted text", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-cache-"));
    const cache = new DetectorResultCache(stateDir);
    const secretText = "PRIVATE-DOCUMENT-CONTENT-DO-NOT-PERSIST";
    await cache.set("a".repeat(64), makeReport(secretText));
    const serialized = await readFile(
      path.join(stateDir, "ai-detector", "result-cache.json"),
      "utf8",
    );
    expect(serialized).not.toContain(secretText);
    expect(serialized).not.toContain("normalizedText");
    expect((await cache.get("a".repeat(64), secretText))?.normalizedText).toBe(secretText);
    expect((await cache.get("a".repeat(64), secretText))?.cacheHit).toBe(true);
  });

  it("clears persistent and memory state", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-cache-"));
    const cache = new DetectorResultCache(stateDir);
    await cache.set("c".repeat(64), makeReport("sample"));
    await cache.clear();
    expect(await cache.get("c".repeat(64), "sample")).toBeNull();
    expect((await cache.status()).entries).toBe(0);
  });

  it("does not let an analysis that started before clear repopulate the cache", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-cache-"));
    const cache = new DetectorResultCache(stateDir);
    const lookup = await cache.getWithGeneration("e".repeat(64), "sample");

    await cache.clear();
    await expect(
      cache.setIfGeneration("e".repeat(64), makeReport("sample"), lookup.generation),
    ).resolves.toBe(false);
    await expect(cache.status()).resolves.toMatchObject({ entries: 0 });
  });

  it("serializes concurrent writes without losing entries or racing the temp file", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-cache-"));
    const cache = new DetectorResultCache(stateDir);
    const keys = Array.from({ length: 12 }, (_, index) => index.toString(16).padStart(64, "0"));

    await Promise.all(
      keys.map((key, index) => cache.set(key, makeReport(`concurrent sample ${index}`))),
    );

    const serialized = JSON.parse(
      await readFile(path.join(stateDir, "ai-detector", "result-cache.json"), "utf8"),
    ) as { entries: ReadonlyArray<{ key: string }> };
    expect(serialized.entries.map((entry) => entry.key)).toEqual(keys);
    expect((await cache.status()).entries).toBe(keys.length);
  });

  it("ignores structurally invalid cached reports instead of returning corrupted results", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-cache-"));
    const cachePath = path.join(stateDir, "ai-detector", "result-cache.json");
    await mkdir(path.dirname(cachePath), { recursive: true });
    const { normalizedText: _text, cacheHit: _cacheHit, ...report } = makeReport("sample");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            key: "d".repeat(64),
            savedAt: new Date().toISOString(),
            report: { ...report, scores: { likelyAi: 200, uncertain: -100, likelyHuman: 0 } },
          },
        ],
      }),
    );

    const cache = new DetectorResultCache(stateDir);
    await expect(cache.get("d".repeat(64), "sample")).resolves.toBeNull();
    await expect(cache.status()).resolves.toMatchObject({ entries: 0 });
  });

  it("rejects schema-valid cached reports whose percentages violate report invariants", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-cache-"));
    const cachePath = path.join(stateDir, "ai-detector", "result-cache.json");
    await mkdir(path.dirname(cachePath), { recursive: true });
    const { normalizedText: _text, cacheHit: _cacheHit, ...report } = makeReport("sample");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            key: "f".repeat(64),
            savedAt: new Date().toISOString(),
            report: {
              ...report,
              scores: { likelyAi: 100, uncertain: 100, likelyHuman: 100 },
            },
          },
        ],
      }),
    );

    const cache = new DetectorResultCache(stateDir);
    await expect(cache.get("f".repeat(64), "sample")).resolves.toBeNull();
  });
});

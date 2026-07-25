// FILE: resultCache.ts
// Purpose: Bounded detector result cache that never stores submitted text or filenames.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AiDetectorReport as AiDetectorReportSchema,
  type AiDetectorReport,
} from "@synara/contracts";
import { Schema } from "effect";

type CachedReport = Omit<AiDetectorReport, "normalizedText" | "cacheHit">;

interface CacheFile {
  readonly schemaVersion: 1;
  readonly entries: ReadonlyArray<{
    readonly key: string;
    readonly savedAt: string;
    readonly report: CachedReport;
  }>;
}

const MAX_ENTRIES = 100;
const MAX_CACHE_BYTES = 5 * 1024 * 1024;
const decodeReport = Schema.decodeUnknownSync(AiDetectorReportSchema);

function decodeCachedReport(value: unknown): CachedReport | null {
  if (!value || typeof value !== "object" || "normalizedText" in value || "cacheHit" in value) {
    return null;
  }
  try {
    const decoded = decodeReport({ ...value, normalizedText: "", cacheHit: false });
    const { normalizedText: _normalizedText, cacheHit: _cacheHit, ...report } = decoded;
    return report;
  } catch {
    return null;
  }
}

function isSemanticallyValidReport(report: AiDetectorReport): boolean {
  const scoreTotal = report.scores.likelyAi + report.scores.uncertain + report.scores.likelyHuman;
  if (scoreTotal !== (report.eligibleCharacters > 0 ? 100 : 0)) return false;
  if (report.totalCharacters !== report.normalizedText.length) return false;
  if (report.eligibleCharacters + report.excludedCharacters > report.totalCharacters) return false;
  if (createHash("sha256").update(report.normalizedText).digest("hex") !== report.contentHash) {
    return false;
  }
  let previousEnd = 0;
  for (const region of report.regions) {
    if (
      region.start < previousEnd ||
      region.end <= region.start ||
      region.end > report.normalizedText.length
    ) {
      return false;
    }
    previousEnd = region.end;
  }
  return true;
}

export class DetectorResultCache {
  private readonly filePath: string;
  private entries = new Map<string, { savedAt: string; report: CachedReport }>();
  private loaded = false;
  private operation = Promise.resolve();
  private generation = 0;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, "ai-detector", "result-cache.json");
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.operation.then(operation, operation);
    this.operation = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8")) as CacheFile;
      if (raw.schemaVersion !== 1 || !Array.isArray(raw.entries)) return;
      for (const entry of raw.entries.slice(-MAX_ENTRIES)) {
        const report = decodeCachedReport(entry?.report);
        if (/^[a-f0-9]{64}$/.test(entry?.key) && report) {
          this.entries.set(entry.key, { savedAt: entry.savedAt, report });
        }
      }
    } catch {
      this.entries.clear();
    }
  }

  async get(key: string, normalizedText: string): Promise<AiDetectorReport | null> {
    return (await this.getWithGeneration(key, normalizedText)).report;
  }

  async getWithGeneration(
    key: string,
    normalizedText: string,
  ): Promise<{ readonly report: AiDetectorReport | null; readonly generation: number }> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      const value = this.entries.get(key);
      if (!value) return { report: null, generation: this.generation };
      const report = { ...value.report, normalizedText, cacheHit: true };
      if (!isSemanticallyValidReport(report)) {
        this.entries.delete(key);
        await this.persist();
        return { report: null, generation: this.generation };
      }
      this.entries.delete(key);
      this.entries.set(key, value);
      return {
        report,
        generation: this.generation,
      };
    });
  }

  async set(key: string, report: AiDetectorReport): Promise<void> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      await this.writeEntry(key, report);
    });
  }

  async setIfGeneration(
    key: string,
    report: AiDetectorReport,
    generation: number,
  ): Promise<boolean> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      if (generation !== this.generation) return false;
      await this.writeEntry(key, report);
      return true;
    });
  }

  async clear(): Promise<void> {
    return this.serialize(async () => {
      this.generation += 1;
      this.entries.clear();
      this.loaded = true;
      await rm(this.filePath, { force: true });
    });
  }

  private async writeEntry(key: string, report: AiDetectorReport): Promise<void> {
    const { normalizedText: _normalizedText, cacheHit: _cacheHit, ...derived } = report;
    this.entries.delete(key);
    this.entries.set(key, { savedAt: new Date().toISOString(), report: derived });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    await this.persist();
  }

  async status(): Promise<{ entries: number; bytes: number }> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      let bytes = 0;
      try {
        bytes = (await stat(this.filePath)).size;
      } catch {
        bytes = 0;
      }
      return { entries: this.entries.size, bytes };
    });
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const payload: CacheFile = {
      schemaVersion: 1,
      entries: [...this.entries].map(([key, value]) => Object.assign({ key }, value)),
    };
    let json = `${JSON.stringify(payload)}\n`;
    while (Buffer.byteLength(json) > MAX_CACHE_BYTES && this.entries.size > 1) {
      this.entries.delete(this.entries.keys().next().value!);
      json = `${JSON.stringify({ schemaVersion: 1, entries: [...this.entries].map(([key, value]) => Object.assign({ key }, value)) })}\n`;
    }
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, json, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

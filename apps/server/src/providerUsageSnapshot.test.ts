// FILE: providerUsageSnapshot.test.ts
// Purpose: Codex session archives are read from the end, so the final token_count is found
// past chunk boundaries and multi-byte text without loading whole (possibly huge) files.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadLocalProviderUsageLines } from "./providerUsageSnapshot";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tokenCount(totalTokens: number): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp: new Date().toISOString(),
    payload: { type: "token_count", info: { total_token_usage: { total_tokens: totalTokens } } },
  });
}

function writeSession(homePath: string, name: string, lines: string[]): void {
  const now = new Date();
  const dayDir = nodePath.join(
    homePath,
    "sessions",
    `${now.getFullYear()}`,
    `${String(now.getMonth() + 1).padStart(2, "0")}`,
    `${String(now.getDate()).padStart(2, "0")}`,
  );
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(nodePath.join(dayDir, name), `${lines.join("\n")}\n`, "utf8");
}

describe("loadLocalProviderUsageLines (codex)", () => {
  it("finds the last token_count behind chunk boundaries and multi-byte filler", async () => {
    const homePath = mkdtempSync(nodePath.join(os.tmpdir(), "djl-codex-usage-"));
    dirs.push(homePath);
    // ~900 KB of 3-byte characters after the final token_count spans several 256 KB chunks.
    const filler = JSON.stringify({ type: "response_item", text: "汉".repeat(150_000) });
    writeSession(homePath, "a.jsonl", [tokenCount(10), tokenCount(1_200), filler, filler]);
    writeSession(homePath, "b.jsonl", [tokenCount(300)]);

    const lines = await loadLocalProviderUsageLines({
      provider: "codex",
      homeDir: homePath,
      homePath,
    });

    const day = lines.find((line) => line.label === "24h");
    expect(day?.value).toBe("1.5K tokens");
    expect(day?.subtitle).toBe("2 recent sessions");
  });
});

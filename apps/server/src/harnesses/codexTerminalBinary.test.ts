import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCodexTerminalBinary } from "./codexTerminalBinary";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
describe("Codex terminal installation resolution", () => {
  it("finds a newer Bun installation even when npm is first in PATH, then notices another update", async () => {
    const root = mkdtempSync(join(tmpdir(), "djl-codex-resolution-"));
    roots.push(root);
    const npm = join(root, "npm"),
      bun = join(root, ".bun", "bin");
    for (const dir of [npm, bun]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "codex"), "", { mode: 0o755 });
    }
    let newest = "0.153.4";
    const probe = async (binary: string) => ({
      code: 0,
      stdout: `codex-cli ${binary.startsWith(bun) ? newest : "0.147.0"}`,
      stderr: "",
    });
    const env = { HOME: root, PATH: npm };
    expect(await resolveCodexTerminalBinary("codex", env, probe)).toBe(join(bun, "codex"));
    newest = "0.140.0";
    expect(await resolveCodexTerminalBinary("codex", env, probe)).toBe(join(npm, "codex"));
  });
  it("honors an explicit executable instead of silently replacing it", async () => {
    expect(await resolveCodexTerminalBinary("/opt/custom/codex", {})).toBe("/opt/custom/codex");
  });
});

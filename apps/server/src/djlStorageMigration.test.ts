import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateLegacyDjlStorage } from "./djlStorageMigration";

const tempDirs: string[] = [];

async function makeRoots() {
  const root = await mkdtemp(join(tmpdir(), "djl-storage-migration-"));
  tempDirs.push(root);
  return {
    canonicalBaseDir: join(root, ".djl"),
    legacyBaseDir: join(root, ".synara"),
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("migrateLegacyDjlStorage", () => {
  it("copies legacy state and merges credentials without overwriting canonical providers", async () => {
    const roots = await makeRoots();
    const canonicalAuth = join(roots.canonicalBaseDir, "userdata/opencode/data/opencode/auth.json");
    const legacyUserdataAuth = join(
      roots.legacyBaseDir,
      "userdata/opencode/data/opencode/auth.json",
    );
    const legacyDevAuth = join(roots.legacyBaseDir, "dev/opencode/data/opencode/auth.json");

    await writeJson(canonicalAuth, {
      openai: { type: "api", key: "canonical-openai-secret" },
    });
    await writeJson(legacyUserdataAuth, {
      openai: { type: "api", key: "legacy-openai-secret" },
      deepseek: { type: "api", key: "legacy-deepseek-secret" },
    });
    await writeJson(legacyDevAuth, {
      anthropic: { type: "api", key: "legacy-anthropic-secret" },
    });
    await mkdir(join(roots.legacyBaseDir, "userdata"), { recursive: true });
    await writeFile(join(roots.legacyBaseDir, "userdata/settings.json"), '{"theme":"dark"}\n');

    const result = await migrateLegacyDjlStorage({ ...roots, importLegacyDefault: true });
    const saved = JSON.parse(await readFile(canonicalAuth, "utf8")) as Record<string, unknown>;

    expect(saved).toEqual({
      openai: { type: "api", key: "canonical-openai-secret" },
      deepseek: { type: "api", key: "legacy-deepseek-secret" },
      anthropic: { type: "api", key: "legacy-anthropic-secret" },
    });
    expect(result.migratedProviderIds).toEqual(["anthropic", "deepseek"]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(await readFile(join(roots.canonicalBaseDir, "userdata/settings.json"), "utf8")).toBe(
      '{"theme":"dark"}\n',
    );
    if (process.platform !== "win32") {
      expect((await stat(canonicalAuth)).mode & 0o777).toBe(0o600);
    }

    const second = await migrateLegacyDjlStorage({ ...roots, importLegacyDefault: true });
    expect(second.migratedProviderIds).toEqual([]);
    expect(second.copiedRelativePaths).toEqual([]);
  });

  it("never imports the default legacy profile into an explicit custom home", async () => {
    const roots = await makeRoots();
    await writeJson(join(roots.legacyBaseDir, "dev/opencode/data/opencode/auth.json"), {
      deepseek: { type: "api", key: "must-not-migrate" },
    });

    const result = await migrateLegacyDjlStorage({ ...roots, importLegacyDefault: false });

    expect(result).toEqual({ copiedRelativePaths: [], migratedProviderIds: [], warnings: [] });
    await expect(
      readFile(join(roots.canonicalBaseDir, "userdata/opencode/data/opencode/auth.json")),
    ).rejects.toThrow();
  });

  it("ignores malformed legacy credential files without exposing their contents", async () => {
    const roots = await makeRoots();
    const malformedPath = join(roots.legacyBaseDir, "userdata/opencode/data/opencode/auth.json");
    await mkdir(join(malformedPath, ".."), { recursive: true });
    await writeFile(malformedPath, '{"deepseek":{"key":"top-secret"');

    const result = await migrateLegacyDjlStorage({ ...roots, importLegacyDefault: true });

    expect(result.migratedProviderIds).toEqual([]);
    expect(result.warnings).toEqual(["Skipped an invalid legacy OpenCode credential file."]);
    expect(JSON.stringify(result)).not.toContain("top-secret");
  });

  it("merges missing development state into shared userdata without replacing production", async () => {
    const roots = await makeRoots();
    await mkdir(join(roots.canonicalBaseDir, "userdata"), { recursive: true });
    await writeFile(join(roots.canonicalBaseDir, "userdata/state.sqlite"), "production-db");
    await mkdir(join(roots.legacyBaseDir, "dev/ai-detector/models/en"), { recursive: true });
    await writeFile(join(roots.legacyBaseDir, "dev/state.sqlite"), "development-db");
    await writeFile(join(roots.legacyBaseDir, "dev/state.sqlite-wal"), "development-wal");
    await writeFile(
      join(roots.legacyBaseDir, "dev/ai-detector/models/en/install.json"),
      "model-metadata",
    );

    await migrateLegacyDjlStorage({
      ...roots,
      importLegacyDefault: true,
      mergeDevelopmentIntoUserdata: true,
    });

    await expect(
      readFile(join(roots.canonicalBaseDir, "userdata/state.sqlite"), "utf8"),
    ).resolves.toBe("production-db");
    await expect(
      readFile(join(roots.canonicalBaseDir, "userdata/ai-detector/models/en/install.json"), "utf8"),
    ).resolves.toBe("model-metadata");
    await expect(
      readFile(join(roots.canonicalBaseDir, "userdata/state.sqlite-wal")),
    ).rejects.toThrow();
  });
});

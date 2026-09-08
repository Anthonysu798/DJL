import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  listLegacyOpenCodeCredentials,
  transferLegacyOpenCodeCredentials,
} from "./openCodeCredentialTransfer";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "djl-auth-transfer-"));
  roots.push(root);
  const legacyRootDir = join(root, "legacy");
  const data = join(root, "shared");
  await mkdir(join(legacyRootDir, "data", "opencode"), { recursive: true });
  await mkdir(data);
  return {
    source: join(legacyRootDir, "data", "opencode", "auth.json"),
    destination: join(data, "auth.json"),
    options: { legacyRootDir, binaryPath: "/unused", resolveDataDirectory: async () => data },
  };
}
describe("legacy OpenCode credential transfer", () => {
  it("lists only provider IDs without transferring or exposing values", async () => {
    const f = await fixture();
    await writeFile(f.source, JSON.stringify({ openai: { type: "api", key: "private-key" } }));
    expect(await listLegacyOpenCodeCredentials(f.options)).toEqual({
      availableProviderIds: ["openai"],
      existingProviderIds: [],
      transferredProviderIds: [],
    });
    await expect(readFile(f.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps existing CLI credentials, retains complete OAuth data and backs up the source", async () => {
    const f = await fixture();
    const oauth = {
      type: "oauth",
      refresh: "private-refresh",
      access: "private-access",
      expires: 12345,
      accountId: "account",
      enterpriseUrl: "https://enterprise.example",
    };
    const source = JSON.stringify({ openai: { type: "api", key: "old" }, anthropic: oauth });
    await writeFile(f.source, source);
    const existing = {
      openai: { type: "api", key: "existing" },
      extra: { type: "api", key: "keep" },
    };
    await writeFile(f.destination, JSON.stringify(existing));
    expect(await transferLegacyOpenCodeCredentials(f.options)).toEqual({
      availableProviderIds: [],
      existingProviderIds: ["openai"],
      transferredProviderIds: ["anthropic"],
    });
    expect(JSON.parse(await readFile(f.destination, "utf8"))).toEqual({
      ...existing,
      anthropic: oauth,
    });
    expect(await readFile(f.source, "utf8")).toBe(source);
    const backupDirectory = join(f.options.legacyRootDir, "credential-transfer-backups");
    const backups = await readdir(backupDirectory);
    expect(await readFile(join(backupDirectory, backups[0]!), "utf8")).toBe(source);
    if (process.platform !== "win32") expect((await stat(f.destination)).mode & 0o777).toBe(0o600);
    expect((await transferLegacyOpenCodeCredentials(f.options)).transferredProviderIds).toEqual([]);
  });
  it("creates an absent shared store exclusively", async () => {
    const f = await fixture();
    await writeFile(f.source, JSON.stringify({ openai: { type: "api", key: "private" } }));
    await transferLegacyOpenCodeCredentials(f.options);
    expect(JSON.parse(await readFile(f.destination, "utf8"))).toEqual({
      openai: { type: "api", key: "private" },
    });
  });
  it("does not overwrite malformed destination data or include it in errors", async () => {
    const f = await fixture();
    await writeFile(f.source, JSON.stringify({ openai: { type: "api", key: "private" } }));
    await writeFile(f.destination, "private-malformed-data");
    await expect(transferLegacyOpenCodeCredentials(f.options)).rejects.toThrow(
      "credential store is invalid",
    );
    expect(await readFile(f.destination, "utf8")).toBe("private-malformed-data");
  });
  it("fails safely when another transfer holds the exclusive lock", async () => {
    const f = await fixture();
    await writeFile(f.source, JSON.stringify({ openai: { type: "api", key: "private" } }));
    await writeFile(
      join(await f.options.resolveDataDirectory(), "auth.json.djl-transfer.lock"),
      "",
    );
    await expect(transferLegacyOpenCodeCredentials(f.options)).rejects.toThrow("in progress");
    await expect(readFile(f.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it.skipIf(!process.env.DJL_TEST_OPENCODE_BINARY)(
  "locates the official CLI store and makes transferred credentials visible to auth list",
  async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const f = await fixture();
    const directory = await f.options.resolveDataDirectory();
    const env = {
      ...process.env,
      XDG_DATA_HOME: join(directory, "data"),
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_STATE_HOME: join(directory, "state"),
      XDG_CACHE_HOME: join(directory, "cache"),
    };
    await writeFile(
      f.source,
      JSON.stringify({ openai: { type: "api", key: "synthetic-transfer-fixture" } }),
    );
    const options = {
      legacyRootDir: f.options.legacyRootDir,
      binaryPath: process.env.DJL_TEST_OPENCODE_BINARY!,
      env,
    };
    expect((await transferLegacyOpenCodeCredentials(options)).transferredProviderIds).toEqual([
      "openai",
    ]);
    const result = await promisify(execFile)(options.binaryPath, ["auth", "list"], {
      env,
      encoding: "utf8",
    });
    expect(result.stdout).toContain("OpenAI");
    expect(result.stdout).not.toContain("synthetic-transfer-fixture");
  },
);

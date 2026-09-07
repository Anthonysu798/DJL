import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  migrateInstalledOpenCodeSession,
  type InstalledOpenCodeMigrationOptions,
  type OpenCodeMigrationCommand,
} from "./openCodeInstalledMigration.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const transcript = {
  info: { id: "ses_fixture", projectID: "old", directory: "/project", title: "Preserve me" },
  messages: [
    {
      info: { id: "msg_one" },
      parts: [{ id: "prt_one", type: "text", text: "Private transcript" }],
    },
  ],
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "djl-session-migration-"));
  roots.push(root);
  const legacyRootDir = join(root, "legacy");
  await mkdir(join(legacyRootDir, "data", "opencode"), { recursive: true });
  await writeFile(join(legacyRootDir, "data", "opencode", "auth.json"), "secret");
  const calls: OpenCodeMigrationCommand[] = [];
  let shared: typeof transcript | undefined;
  const options: InstalledOpenCodeMigrationOptions = {
    binaryPath: "/installed/opencode",
    legacyRootDir,
    sessionId: transcript.info.id,
    cwd: "/project",
    env: { XDG_DATA_HOME: join(root, "shared") },
    runCommand: async (command) => {
      calls.push(command);
      if (command.args[0] === "import") {
        shared = JSON.parse(await readFile(command.args[1]!, "utf8"));
        return { exitCode: 0, stdout: "Imported", stderr: "" };
      }
      const data = command.env.XDG_DATA_HOME === options.env.XDG_DATA_HOME ? shared : transcript;
      return data
        ? { exitCode: 0, stdout: JSON.stringify(data), stderr: "" }
        : { exitCode: 1, stdout: "", stderr: `Session not found: ${transcript.info.id}` };
    },
  };
  return {
    root,
    options,
    calls,
    setShared: (data: typeof transcript) => {
      shared = data;
    },
  };
}

describe("migrateInstalledOpenCodeSession", () => {
  it("backs up committed WAL data without upgrading the original database", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const f = await fixture();
    const path = join(f.options.legacyRootDir, "data", "opencode", "opencode.db");
    const source = new DatabaseSync(path);
    try {
      source.exec(
        "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('committed in WAL');",
      );
      await migrateInstalledOpenCodeSession(f.options);
      const files = await readdir(f.options.legacyRootDir, { recursive: true });
      const backupPath = files.find((file) => file.endsWith("backup/opencode/opencode.db"));
      expect(backupPath).toBeDefined();
      const copied = new DatabaseSync(join(f.options.legacyRootDir, backupPath!), {
        readOnly: true,
      });
      try {
        expect(copied.prepare("SELECT value FROM fixture").get()?.value).toBe("committed in WAL");
      } finally {
        copied.close();
      }
      expect(source.prepare("SELECT value FROM fixture").get()?.value).toBe("committed in WAL");
    } finally {
      source.close();
    }
  });

  it("retains a private export and backup, excludes auth, imports once and allows subsequent turns", async () => {
    const f = await fixture();
    expect(await migrateInstalledOpenCodeSession(f.options)).toBe("ses_fixture");
    const files = await readdir(join(f.options.legacyRootDir, "installed-cli-migrations"), {
      recursive: true,
    });
    expect(files.some((file) => file.endsWith("session.json"))).toBe(true);
    expect(files.some((file) => file.endsWith("complete.json"))).toBe(true);
    expect(files.some((file) => file.endsWith("auth.json"))).toBe(false);
    expect(await readFile(join(f.options.legacyRootDir, "data/opencode/auth.json"), "utf8")).toBe(
      "secret",
    );
    f.setShared({ ...transcript, messages: [...transcript.messages, ...transcript.messages] });
    await migrateInstalledOpenCodeSession(f.options);
    expect(f.calls.filter((call) => call.args[0] === "import")).toHaveLength(1);
  });
  it("serializes simultaneous requests", async () => {
    const f = await fixture();
    await Promise.all([
      migrateInstalledOpenCodeSession(f.options),
      migrateInstalledOpenCodeSession(f.options),
    ]);
    expect(f.calls.filter((call) => call.args[0] === "import")).toHaveLength(1);
  });
  it("does not import over a divergent shared session", async () => {
    const f = await fixture();
    f.setShared({ ...transcript, info: { ...transcript.info, title: "Conflicting title" } });
    await expect(migrateInstalledOpenCodeSession(f.options)).rejects.toThrow("conflicts");
    expect(f.calls.some((call) => call.args[0] === "import")).toBe(false);
  });
  it("recovers an import that finished before the process failed", async () => {
    const f = await fixture();
    const run = f.options.runCommand!;
    let interrupt = true;
    const options = {
      ...f.options,
      runCommand: async (command: OpenCodeMigrationCommand) => {
        const result = await run(command);
        if (command.args[0] === "import" && interrupt) {
          interrupt = false;
          throw new Error("Process interrupted");
        }
        return result;
      },
    };
    await expect(migrateInstalledOpenCodeSession(options)).rejects.toThrow("interrupted");
    await migrateInstalledOpenCodeSession(options);
    expect(f.calls.filter((call) => call.args[0] === "import")).toHaveLength(1);
  });
  it("does not treat an arbitrary CLI failure as a missing session", async () => {
    const f = await fixture();
    const run = f.options.runCommand!;
    await expect(
      migrateInstalledOpenCodeSession({
        ...f.options,
        runCommand: (command) =>
          command.env === f.options.env
            ? Promise.resolve({ exitCode: 1, stdout: "", stderr: "Database locked" })
            : run(command),
      }),
    ).rejects.toThrow("Unable to check");
    expect(f.calls.some((call) => call.args[0] === "import")).toBe(false);
  });
  it("rejects invalid session identifiers before touching storage", async () => {
    const f = await fixture();
    await expect(
      migrateInstalledOpenCodeSession({ ...f.options, sessionId: "../../escape" }),
    ).rejects.toThrow("Invalid legacy");
  });
});

it.skipIf(!process.env.DJL_TEST_OPENCODE_BINARY)(
  "round-trips a real CLI session through an online SQLite backup",
  async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execute = promisify(execFile);
    const f = await fixture();
    const binary = process.env.DJL_TEST_OPENCODE_BINARY!;
    const cwd = f.root;
    const env = {
      ...process.env,
      XDG_DATA_HOME: join(f.options.legacyRootDir, "data"),
      XDG_CONFIG_HOME: join(f.root, "config"),
      XDG_CACHE_HOME: join(f.root, "cache"),
      XDG_STATE_HOME: join(f.root, "state"),
    };
    const fixturePath = join(f.root, "fixture.json");
    const id = "ses_abcdef0123456789abcdef012345";
    await writeFile(
      fixturePath,
      JSON.stringify({
        info: {
          id,
          slug: "migration-fixture",
          version: "1.18.29",
          projectID: "global",
          directory: cwd,
          title: "Migration fixture",
          time: { created: 1700000000000, updated: 1700000000000 },
        },
        messages: [
          {
            info: {
              id: "msg_abcdef0123456789abcdef012345",
              sessionID: id,
              role: "user",
              time: { created: 1700000000000 },
              agent: "build",
              model: { providerID: "openai", modelID: "gpt-4" },
            },
            parts: [
              {
                id: "prt_abcdef0123456789abcdef012345",
                sessionID: id,
                messageID: "msg_abcdef0123456789abcdef012345",
                type: "text",
                text: "Keep this transcript exactly.",
              },
            ],
          },
        ],
      }),
    );
    await execute(binary, ["import", fixturePath], { cwd, env });
    const before = await execute(binary, ["export", id], { cwd, env });
    const sharedEnv = { ...env, XDG_DATA_HOME: join(f.root, "shared") };
    await migrateInstalledOpenCodeSession({
      legacyRootDir: f.options.legacyRootDir,
      binaryPath: binary,
      sessionId: id,
      cwd,
      env: sharedEnv,
    });
    const after = await execute(binary, ["export", id], { cwd, env: sharedEnv });
    expect(JSON.parse(after.stdout)).toEqual(JSON.parse(before.stdout));
  },
);

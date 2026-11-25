// End-to-end check of the one-click provider update: the real ProviderHealth layer and the real
// process spawner run a fake `codex` and a fake `npm` from a temporary PATH. Nothing here touches
// the user's installed CLIs or the network (the npm registry lookup is stubbed).
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS } from "@djl/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { vi } from "vitest";

import { ServerConfig } from "../../config";
import { ServerSettingsService } from "../../serverSettings";
import { ProviderHealth } from "../Services/ProviderHealth";
import { ProviderHealthLive } from "./ProviderHealth";

const INSTALLED_VERSION = "1.0.0";
const LATEST_VERSION = "2.0.0";

type Installer =
  | "installs-latest"
  | "does-nothing"
  | "installs-elsewhere"
  | "breaks-cli"
  | "fails"
  | "missing";

const onlyCodexEnabled = {
  enableProviderUpdateChecks: true,
  providers: Object.fromEntries(
    Object.entries(DEFAULT_SERVER_SETTINGS.providers).map(([provider, settings]) => [
      provider,
      { ...settings, enabled: provider === "codex" },
    ]),
  ),
} as unknown as Partial<typeof DEFAULT_SERVER_SETTINGS>;

/**
 * Lays out an npm-global style install in a temp dir and points PATH at it:
 *
 *   prefix/bin/codex -> ../lib/node_modules/@openai/codex/bin/codex.js   (prints the version file)
 *   tools/npm                                                            (the fake installer)
 */
const setUpFakeInstall = Effect.fn("setUpFakeInstall")(function* (installer: Installer) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "djl-provider-update-" });
  const packageDir = path.join(root, "prefix", "lib", "node_modules", "@openai", "codex");
  const binDir = path.join(root, "prefix", "bin");
  const toolsDir = path.join(root, "tools");
  const versionFile = path.join(packageDir, "version");
  const installerLog = path.join(root, "npm-invocations.log");
  yield* fileSystem.makeDirectory(path.join(packageDir, "bin"), { recursive: true });
  yield* fileSystem.makeDirectory(binDir, { recursive: true });
  yield* fileSystem.makeDirectory(toolsDir, { recursive: true });
  yield* fileSystem.writeFileString(versionFile, INSTALLED_VERSION);

  const codexScript = path.join(packageDir, "bin", "codex.js");
  yield* fileSystem.writeFileString(
    codexScript,
    [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then echo "codex-cli $(/bin/cat '${versionFile}')"; exit 0; fi`,
      `echo "Logged in using ChatGPT"`,
      "",
    ].join("\n"),
  );
  yield* fileSystem.chmod(codexScript, 0o755);
  yield* fileSystem.symlink(codexScript, path.join(binDir, "codex"));

  const installerBody: Record<Installer, ReadonlyArray<string>> = {
    "installs-latest": [
      `printf '%s' '${LATEST_VERSION}' > '${versionFile}'`,
      "echo 'changed 1 package in 1s'",
    ],
    "does-nothing": ["echo 'up to date in 1s'"],
    fails: [
      "echo 'npm error code EACCES' >&2",
      "echo 'npm error syscall mkdir' >&2",
      "echo 'npm error A complete log of this run can be found in: /tmp/npm.log' >&2",
      "exit 243",
    ],
    // Installs the new version, but into a different prefix than the one first on PATH.
    "installs-elsewhere": [
      `/bin/mkdir -p '${path.join(root, "other-prefix")}'`,
      `printf '%s' '${LATEST_VERSION}' > '${path.join(root, "other-prefix", "version")}'`,
      "echo 'added 1 package in 1s'",
    ],
    "breaks-cli": [`/bin/rm '${path.join(binDir, "codex")}'`, "echo 'changed 1 package in 1s'"],
    missing: [],
  };
  if (installer !== "missing") {
    const npmScript = path.join(toolsDir, "npm");
    yield* fileSystem.writeFileString(
      npmScript,
      ["#!/bin/sh", `echo "$*" >> '${installerLog}'`, ...installerBody[installer], ""].join("\n"),
    );
    yield* fileSystem.chmod(npmScript, 0o755);
  }

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previousPath = process.env.PATH;
      // Only the fakes are reachable: a real `npm` or `codex` on this machine can never run.
      process.env.PATH = [binDir, toolsDir].join(":");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ version: LATEST_VERSION })),
      );
      return previousPath;
    }),
    (previousPath) =>
      Effect.sync(() => {
        vi.unstubAllGlobals();
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      }),
  );

  const layer = ProviderHealthLive.pipe(
    Layer.provide(ServerSettingsService.layerTest(onlyCodexEnabled)),
    Layer.provide(ServerConfig.layerTest(process.cwd(), path.join(root, "djl-home"))),
  );
  return {
    layer,
    binary: path.join(binDir, "codex"),
    readInstalledVersion: fileSystem.readFileString(versionFile),
    readInstallerInvocations: fileSystem
      .readFileString(installerLog)
      .pipe(Effect.map((log) => log.trim().split("\n"))),
  };
});

const runUpdate = Effect.gen(function* () {
  const health = yield* ProviderHealth;
  const before = (yield* health.refresh).find((status) => status.provider === "codex");
  const result = yield* health.updateProvider({ provider: "codex" });
  const after = result.providers.find((status) => status.provider === "codex");
  return { before, after };
});

it.layer(NodeServices.layer)("ProviderHealth one-click update (real processes)", (it) => {
  describe.skipIf(process.platform === "win32")("codex installed as an npm global", () => {
    it.effect(
      "runs the installer and reports success only once the CLI reports the new version",
      () =>
        Effect.gen(function* () {
          const install = yield* setUpFakeInstall("installs-latest");
          const { before, after } = yield* runUpdate.pipe(Effect.provide(install.layer));

          assert.strictEqual(before?.version, INSTALLED_VERSION);
          assert.strictEqual(before?.versionAdvisory?.status, "behind_latest");
          assert.strictEqual(before?.versionAdvisory?.canUpdate, true);
          assert.strictEqual(
            before?.versionAdvisory?.updateCommand,
            "npm install -g @openai/codex@latest",
          );

          assert.deepStrictEqual(yield* install.readInstallerInvocations, [
            "install -g @openai/codex@latest",
          ]);
          assert.strictEqual(yield* install.readInstalledVersion, LATEST_VERSION);
          assert.strictEqual(after?.updateState?.status, "succeeded");
          assert.strictEqual(after?.version, LATEST_VERSION);
          assert.strictEqual(after?.versionAdvisory?.status, "current");
        }),
    );

    it.effect("reports a failure when the installer exits 0 without changing the CLI", () =>
      Effect.gen(function* () {
        const install = yield* setUpFakeInstall("does-nothing");
        const { after } = yield* runUpdate.pipe(Effect.provide(install.layer));

        assert.strictEqual(yield* install.readInstalledVersion, INSTALLED_VERSION);
        assert.strictEqual(after?.updateState?.status, "unchanged");
        assert.strictEqual(after?.version, INSTALLED_VERSION);
        assert.strictEqual(after?.versionAdvisory?.status, "behind_latest");
        const message = after?.updateState?.message ?? "";
        assert.include(message, "npm install -g @openai/codex@latest");
        assert.include(message, install.binary);
        assert.include(message, INSTALLED_VERSION);
        assert.include(message, LATEST_VERSION);
      }),
    );

    it.effect("reports a failure when the installer updates a different install", () =>
      Effect.gen(function* () {
        const install = yield* setUpFakeInstall("installs-elsewhere");
        const { after } = yield* runUpdate.pipe(Effect.provide(install.layer));

        assert.strictEqual(yield* install.readInstalledVersion, INSTALLED_VERSION);
        assert.strictEqual(after?.updateState?.status, "unchanged");
        assert.include(after?.updateState?.message ?? "", install.binary);
      }),
    );

    it.effect("reports a failure when the CLI no longer runs after the installer exits 0", () =>
      Effect.gen(function* () {
        const install = yield* setUpFakeInstall("breaks-cli");
        const { after } = yield* runUpdate.pipe(Effect.provide(install.layer));

        assert.strictEqual(after?.updateState?.status, "failed");
        assert.include(after?.updateState?.message ?? "", "could not read a version");
        assert.include(after?.updateState?.message ?? "", install.binary);
      }),
    );

    it.effect("reports a failure when the package manager is not on PATH", () =>
      Effect.gen(function* () {
        const install = yield* setUpFakeInstall("missing");
        const { after } = yield* runUpdate.pipe(Effect.provide(install.layer));

        assert.strictEqual(yield* install.readInstalledVersion, INSTALLED_VERSION);
        assert.strictEqual(after?.updateState?.status, "failed");
        assert.include(after?.updateState?.message ?? "", "`npm` was not found on DJL's PATH");
      }),
    );

    it.effect("reports the installer's own error when it fails", () =>
      Effect.gen(function* () {
        const install = yield* setUpFakeInstall("fails");
        const { after } = yield* runUpdate.pipe(Effect.provide(install.layer));

        assert.strictEqual(yield* install.readInstalledVersion, INSTALLED_VERSION);
        assert.strictEqual(after?.updateState?.status, "failed");
        const message = after?.updateState?.message ?? "";
        assert.include(message, "243");
        assert.include(message, "npm error code EACCES");
        assert.include(after?.updateState?.output ?? "", "npm error syscall mkdir");
        assert.strictEqual(
          after?.versionAdvisory?.updateCommand,
          "npm install -g @openai/codex@latest",
        );
      }),
    );
  });
});

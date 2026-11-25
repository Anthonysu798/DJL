import { describe, it, assert } from "@effect/vitest";

import {
  createProviderVersionAdvisory,
  describeUpdateCommandFailure,
  parseGenericCliVersion,
  resolvePackageManagedProviderMaintenance,
  verifyProviderUpdate,
  type PackageManagedProviderMaintenanceDefinition,
} from "./providerMaintenance";

const CODEX_DEFINITION = {
  provider: "codex",
  binaryName: "codex",
  npmPackageName: "@openai/codex",
  homebrew: { name: "codex", kind: "cask" },
  nativeUpdate: null,
} as const satisfies PackageManagedProviderMaintenanceDefinition;

const OPENCODE_DEFINITION = {
  provider: "opencode",
  binaryName: "opencode",
  npmPackageName: "opencode-ai",
  homebrew: { name: "anomalyco/tap/opencode", kind: "formula" },
  latestVersionSource: { kind: "npm", name: "opencode-ai" },
  nativeUpdate: {
    executable: "opencode",
    args: (installSource) =>
      installSource === "unknown" || installSource === "native"
        ? ["upgrade"]
        : ["upgrade", "--method", installSource],
    lockKey: "opencode-native",
    strategy: "always",
    excludedInstallSources: ["homebrew"],
  },
} as const satisfies PackageManagedProviderMaintenanceDefinition;

describe("providerMaintenance", () => {
  it("parses generic CLI versions", () => {
    assert.strictEqual(parseGenericCliVersion("codex-cli 0.130.0\n"), "0.130.0");
    assert.strictEqual(parseGenericCliVersion("claude 2.1\n"), "2.1.0");
    assert.strictEqual(parseGenericCliVersion("no version here"), null);
  });

  it("resolves npm global update commands for unqualified binaries", () => {
    const capabilities = resolvePackageManagedProviderMaintenance(CODEX_DEFINITION, {
      binaryPath: "codex",
      realCommandPath: "/Users/test/.npm-global/lib/node_modules/@openai/codex/bin/codex",
    });

    assert.deepStrictEqual(capabilities.update, {
      command: "npm install -g @openai/codex@latest",
      executable: "npm",
      args: ["install", "-g", "@openai/codex@latest"],
      lockKey: "npm-global",
    });
  });

  it("does not guess an update command for unclassified binaries", () => {
    const capabilities = resolvePackageManagedProviderMaintenance(CODEX_DEFINITION, {
      binaryPath: "/custom/bin/codex",
      realCommandPath: "/custom/bin/codex",
    });

    assert.strictEqual(capabilities.update, null);
  });

  it("resolves Homebrew cask update commands", () => {
    const capabilities = resolvePackageManagedProviderMaintenance(CODEX_DEFINITION, {
      binaryPath: "/opt/homebrew/bin/codex",
      realCommandPath: "/opt/homebrew/Caskroom/codex/0.130.0/codex",
    });

    assert.deepStrictEqual(capabilities.update, {
      command: "brew upgrade --cask codex",
      executable: "brew",
      args: ["upgrade", "--cask", "codex"],
      lockKey: "homebrew",
    });
    assert.strictEqual(capabilities.packageName, null);
  });

  it("uses provider-native update commands with detected install method", () => {
    const capabilities = resolvePackageManagedProviderMaintenance(OPENCODE_DEFINITION, {
      binaryPath: "opencode",
      realCommandPath: "/Users/test/.local/share/pnpm/opencode",
    });

    assert.deepStrictEqual(capabilities.update, {
      command: "opencode upgrade --method pnpm",
      executable: "opencode",
      args: ["upgrade", "--method", "pnpm"],
      lockKey: "opencode-native",
    });
    assert.deepStrictEqual(capabilities.latestVersionSource, {
      kind: "npm",
      name: "opencode-ai",
    });
  });

  it("uses Homebrew updates but keeps npm latest metadata for tapped OpenCode installs", () => {
    const capabilities = resolvePackageManagedProviderMaintenance(OPENCODE_DEFINITION, {
      binaryPath: "opencode",
      realCommandPath: "/opt/homebrew/Cellar/opencode/1.14.46/bin/opencode",
    });

    assert.deepStrictEqual(capabilities.update, {
      command: "brew upgrade anomalyco/tap/opencode",
      executable: "brew",
      args: ["upgrade", "anomalyco/tap/opencode"],
      lockKey: "homebrew",
    });
    assert.deepStrictEqual(capabilities.latestVersionSource, {
      kind: "npm",
      name: "opencode-ai",
    });
  });

  it("marks older semver versions as behind latest", () => {
    const advisory = createProviderVersionAdvisory({
      provider: "codex",
      currentVersion: "0.129.0",
      latestVersion: "0.130.0",
    });

    assert.strictEqual(advisory.status, "behind_latest");
    assert.strictEqual(advisory.currentVersion, "0.129.0");
    assert.strictEqual(advisory.latestVersion, "0.130.0");
  });
});

describe("verifyProviderUpdate", () => {
  const ran = {
    command: "npm install -g @openai/codex@latest",
    cliPath: "/Users/test/.npm-global/bin/codex",
  };

  it("succeeds once the CLI reports the latest version", () => {
    assert.deepStrictEqual(
      verifyProviderUpdate({
        ...ran,
        versionBefore: "0.171.0",
        versionAfter: "0.172.0",
        latestVersion: "0.172.0",
      }),
      { status: "succeeded", message: "Updated from 0.171.0 to 0.172.0." },
    );
  });

  it("does not call an unchanged, outdated CLI updated just because the command exited 0", () => {
    const result = verifyProviderUpdate({
      ...ran,
      versionBefore: "0.171.0",
      versionAfter: "0.171.0",
      latestVersion: "0.172.0",
    });

    assert.strictEqual(result.status, "unchanged");
    assert.include(result.message, ran.command);
    assert.include(result.message, `${ran.cliPath} still reports 0.171.0`);
    assert.include(result.message, "the latest is 0.172.0");
    assert.include(result.message, "different location");
  });

  it("reports a partial update that is still behind the latest version", () => {
    const result = verifyProviderUpdate({
      ...ran,
      versionBefore: "0.170.0",
      versionAfter: "0.171.0",
      latestVersion: "0.172.0",
    });

    assert.strictEqual(result.status, "unchanged");
    assert.include(result.message, "now reports 0.171.0");
    assert.notInclude(result.message, "different location");
  });

  it("fails when the CLI can no longer report a version", () => {
    const result = verifyProviderUpdate({
      ...ran,
      versionBefore: "0.171.0",
      versionAfter: null,
      latestVersion: "0.172.0",
    });

    assert.strictEqual(result.status, "failed");
    assert.include(result.message, `could not read a version from ${ran.cliPath}`);
  });

  it("needs a version change when the latest version is unknown", () => {
    assert.strictEqual(
      verifyProviderUpdate({
        ...ran,
        versionBefore: "0.171.0",
        versionAfter: "0.172.0",
        latestVersion: null,
      }).status,
      "succeeded",
    );

    const unverified = verifyProviderUpdate({
      ...ran,
      versionBefore: "0.171.0",
      versionAfter: "0.171.0",
      latestVersion: null,
    });
    assert.strictEqual(unverified.status, "unchanged");
    assert.include(unverified.message, "could not look up the latest version");
  });

  it("accepts a CLI that was already current", () => {
    assert.deepStrictEqual(
      verifyProviderUpdate({
        ...ran,
        versionBefore: "0.172.0",
        versionAfter: "0.172.0",
        latestVersion: "0.172.0",
      }),
      { status: "succeeded", message: "0.172.0 is installed." },
    );
  });
});

describe("describeUpdateCommandFailure", () => {
  const command = "npm install -g @openai/codex@latest";

  it("names the installer's own error instead of its trailing log path", () => {
    assert.strictEqual(
      describeUpdateCommandFailure({
        command,
        exitCode: 243,
        stderr:
          "npm error code EACCES\nnpm error syscall mkdir\nnpm error A complete log of this run can be found in: /tmp/npm.log\n",
        stdout: "",
      }),
      "`npm install -g @openai/codex@latest` exited with code 243: npm error code EACCES",
    );
  });

  it("falls back to the last line of output", () => {
    assert.strictEqual(
      describeUpdateCommandFailure({
        command,
        exitCode: 1,
        stderr: "",
        stdout: "resolving\nregistry unreachable\n",
      }),
      "`npm install -g @openai/codex@latest` exited with code 1: registry unreachable",
    );
  });

  it("says so when the command printed nothing", () => {
    assert.strictEqual(
      describeUpdateCommandFailure({ command, exitCode: 1, stderr: "", stdout: "" }),
      "`npm install -g @openai/codex@latest` exited with code 1 without any output.",
    );
  });
});

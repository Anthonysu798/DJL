// Verifies DJL against an OpenCode CLI installed separately from the app (DJL never bundles it).
// Run: node apps/server/scripts/check-installed-opencode.ts <npm-install-prefix> <package> <version>
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { inspectInstalledOpenCodeProtocol } from "../src/provider/openCodeInstalledProtocol.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");

const [prefix, fixturePackage, version] = process.argv.slice(2);
if (!prefix || !fixturePackage || !version)
  throw new Error("Usage: check-installed-opencode.ts <install-prefix> <package> <version>");
const binary = join(
  prefix,
  "node_modules",
  fixturePackage,
  "bin",
  process.platform === "win32" ? "opencode.exe" : "opencode",
);

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env, cwd: repositoryRoot });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const protocol = await inspectInstalledOpenCodeProtocol(binary, version);
if (!protocol.compatible) throw new Error(protocol.compatibilityMessage);
const probe = "scripts/probe-installed-opencode.ts";
for (const [provider, format] of [
  ["ollama", "json"],
  ["lmstudio", "tagged"],
  ["deepseek", "dsml"],
])
  run(process.execPath, [
    probe,
    binary,
    "--compatibility",
    `--provider=${provider}`,
    `--format=${format}`,
  ]);
for (const flags of [["--native-scope"], ["--no-tools"], ["--native-scope", "--no-tools"]])
  run(process.execPath, [probe, binary, "--compatibility", ...flags]);
run(
  "bun",
  [
    "run",
    "--cwd",
    "apps/server",
    "test",
    "--",
    "src/provider/openCodeInstalledAdapter.integration.test.ts",
    "src/provider/openCodeInstalledMigration.test.ts",
    "src/harnesses/openCodeCredentialTransfer.test.ts",
  ],
  { ...process.env, DJL_TEST_OPENCODE_BINARY: binary },
);
console.log(`OpenCode ${version} (${fixturePackage}) is compatible with DJL.`);

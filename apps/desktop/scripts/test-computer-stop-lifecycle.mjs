import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("The native panel regression requires macOS.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preload = join(root, "dist-electron", "computerStopPreload.js");
if (!existsSync(preload)) throw new Error("Build the desktop preload before this regression.");
const directory = mkdtempSync(join(tmpdir(), "djl-stop-lifecycle-"));
try {
  const bundle = join(directory, "fixture.cjs");
  const output = join(directory, "report.json");
  execFileSync(
    "bun",
    [
      "build",
      join(root, "scripts", "computer-stop-lifecycle-fixture.ts"),
      "--target=node",
      "--format=cjs",
      "--external=electron",
      `--outfile=${bundle}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = createRequire(import.meta.url)("electron");
  const child = spawnSync(electron, [bundle, preload, output], {
    env,
    stdio: "inherit",
    timeout: 30_000,
  });
  const report = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null;
  console.log(JSON.stringify(report));
  if (child.error || child.status !== 0 || report?.passed !== true)
    throw new Error("The native Computer Stop window lifecycle regression failed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

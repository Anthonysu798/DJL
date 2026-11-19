import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert.ok(["darwin", "win32"].includes(process.platform), "Use a native macOS or Windows runner");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(path.join(os.tmpdir(), "djl-multipost-native-"));
const receipts = [];
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/hook") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const part of req) body += part;
  receipts.push(JSON.parse(body));
  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      postUrl: `http://127.0.0.1:${server.address().port}/posts/${receipts.length}`,
    }),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/hook`;
try {
  const fixtureApp = path.join(directory, "app");
  mkdirSync(fixtureApp);
  writeFileSync(
    path.join(fixtureApp, "package.json"),
    JSON.stringify({ name: "djl-multipost-lifecycle", private: true, main: "fixture.cjs" }),
  );
  const bundle = path.join(fixtureApp, "fixture.cjs");
  execFileSync(
    "bun",
    [
      "build",
      path.join(root, "scripts/multipost-lifecycle-fixture.ts"),
      "--target=node",
      "--format=cjs",
      "--external=electron",
      "--external=sharp",
      `--outfile=${bundle}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  // Electron does not use NODE_PATH for the initial application module.
  symlinkSync(
    path.join(root, "../server/node_modules"),
    path.join(fixtureApp, "node_modules"),
    "junction",
  );
  const electron = createRequire(import.meta.url)("electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.NODE_PATH = [
    path.join(root, "../server/node_modules"),
    path.join(root, "../../node_modules"),
    env.NODE_PATH,
  ]
    .filter(Boolean)
    .join(path.delimiter);
  const run = (phase) =>
    new Promise((resolve, reject) => {
      const log = path.join(directory, `${phase}.electron.log`);
      const child = spawn(
        electron,
        [
          fixtureApp,
          directory,
          endpoint,
          phase,
          path.join(root, "../../assets/prod/djl-macos-legacy-1024.png"),
          "--enable-logging=file",
          `--log-file=${log}`,
        ],
        { cwd: fixtureApp, env, stdio: "inherit" },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Native ${phase} timed out`));
      }, 45000);
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else {
          const report = path.join(directory, `${phase}.json`);
          const diagnostic = [report, log]
            .filter((file) => existsSync(file))
            .map((file) => readFileSync(file, "utf8").slice(-4096))
            .join("\n");
          reject(new Error(`Native ${phase} exited ${signal ?? code}\n${diagnostic}`));
        }
      });
    });
  await run("publish");
  const first = JSON.parse(readFileSync(path.join(directory, "publish.json"), "utf8"));
  assert.equal(first.passed, true, JSON.stringify(first));
  const saved = JSON.parse(readFileSync(path.join(directory, "resume.json"), "utf8"));
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Date.parse(saved.dueAt) - Date.now() + 150)),
  );
  await run("recover");
  const second = JSON.parse(readFileSync(path.join(directory, "recover.json"), "utf8"));
  assert.equal(second.passed, true, JSON.stringify(second));
  assert.equal(receipts.length, 1, "Duplicate or missed task was submitted");
  assert.equal(
    receipts[0].content.text,
    "Native hidden-window acceptance\nSynthetic localhost acceptance only",
  );
  const report = {
    passed: true,
    platform: process.platform,
    publish: first,
    recovery: second,
    receiptCount: receipts.length,
  };
  const output = process.env.DJL_MULTIPOST_LIFECYCLE_REPORT;
  if (output) writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}

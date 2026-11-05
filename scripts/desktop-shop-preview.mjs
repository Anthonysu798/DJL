import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** No migration from the real home and no cloud/demo session crossover. */
export function previewEnvironment(base, profile, rendererUrl) {
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (name.startsWith("DJL_COMMERCE_") || name === "ELECTRON_RUN_AS_NODE") delete env[name];
  }
  return {
    ...env,
    PATH: `${dirname(process.execPath)}${delimiter}${env.PATH ?? env.Path ?? ""}`,
    HOME: join(profile, "home"),
    USERPROFILE: join(profile, "home"),
    DJL_HOME: join(profile, "data"),
    SYNARA_HOME: join(profile, "data"),
    DJL_DESKTOP_USER_DATA_DIR: join(profile, "electron"),
    SYNARA_DESKTOP_USER_DATA_DIR: join(profile, "electron"),
    SYNARA_DESKTOP_DISPLAY_NAME: "DJL 商城验证",
    VITE_DEV_SERVER_URL: rendererUrl,
  };
}

export function previewPreflight(workspace = root) {
  const checks = [
    ["Electron main", "apps/desktop/dist-electron/main.js"],
    ["Electron preload", "apps/desktop/dist-electron/preload.js"],
    ["Isolated commerce preload", "apps/desktop/dist-electron/commerce-preload.js"],
    ["AI backend", "apps/server/dist/index.mjs"],
    ["Shop prototype", "apps/web/public/shop/index.html"],
  ].map(([name, file]) => ({ name, ok: existsSync(join(workspace, file)) }));
  const major = Number(process.versions.node.split(".")[0]);
  checks.unshift({ name: "Node.js 24+", ok: major >= 24 });
  let vite;
  try {
    const require = createRequire(join(workspace, "apps/web/package.json"));
    vite = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  } catch {
    /* Report a missing dependency, do not install or launch it. */
  }
  checks.push({ name: "Vite runtime", ok: Boolean(vite && existsSync(vite)) });
  try {
    const require = createRequire(join(workspace, "apps/desktop/package.json"));
    checks.push({ name: "Electron runtime", ok: existsSync(require("electron")) });
  } catch {
    checks.push({ name: "Electron runtime", ok: false });
  }
  return { checks, vite };
}

export async function rendererReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.text()).includes("/src/bootstrap.ts");
  } catch {
    return false;
  }
}

async function freshLoopbackPort() {
  const server = createServer();
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : done(port)));
    });
  });
}

export async function runPreview(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== "--check"))
    throw new Error("Usage: node scripts/desktop-shop-preview.mjs [--check]");
  const { checks, vite } = previewPreflight();
  for (const check of checks) console.log(`${check.ok ? "OK" : "MISSING"}: ${check.name}`);
  if (checks.some((check) => !check.ok)) {
    console.error(
      "Install frozen workspace dependencies and build remote-protocol, server and desktop first. See docs/commerce-development.md.",
    );
    return 1;
  }
  if (args.includes("--check")) return 0;

  const profile = join(root, ".djl/smoke-profile");
  // Own our renderer instead of reusing another project's Vite server on a familiar port.
  const port = await freshLoopbackPort();
  const url = `http://127.0.0.1:${port}`;
  const env = previewEnvironment(process.env, profile, url);
  for (const folder of [profile, env.HOME, env.DJL_HOME, env.DJL_DESKTOP_USER_DATA_DIR])
    mkdirSync(folder, { recursive: true });
  let web;
  const launch = (name, entry, argv, cwd) => {
    const log = createWriteStream(join(profile, `${name}.log`), { flags: "a" });
    log.write(`\n--- ${new Date().toISOString()} ---\n`);
    const child = spawn(process.execPath, [entry, ...argv], {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    child.on("error", (error) => log.write(`Launch error: ${error.code ?? error.name}\n`));
    child.once("close", (code, signal) =>
      log.end(`Exit code=${code} signal=${signal ?? "none"}\n`),
    );
    return child;
  };
  try {
    web = launch(
      "manual-web",
      vite,
      ["--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      join(root, "apps/web"),
    );
    let started = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await rendererReady(url)) {
        started = true;
        break;
      }
      if (web.exitCode !== null) break;
      await setTimeout(1000);
    }
    if (!started)
      throw new Error("Renderer did not start. Inspect .djl/smoke-profile/manual-web.log.");
    console.log(
      "Starting full DJL in an isolated profile. Payments/commissions are simulations. Logs: .djl/smoke-profile/manual-desktop.log",
    );
    const desktop = launch(
      "manual-desktop",
      join(root, "apps/desktop/scripts/start-electron.mjs"),
      [],
      root,
    );
    return await new Promise((done) => {
      desktop.once("error", () => done(1));
      desktop.once("close", (code) => done(code ?? 1));
    });
  } finally {
    web?.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runPreview()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

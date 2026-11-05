import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Serve the built Admin separately. This runner owns only the temporary API and browser.
const required = [
  "DATABASE_URL",
  "REDIS_URL",
  "DJL_FINANCE_E2E_PG_DATA",
  "DJL_FINANCE_E2E_REDIS_DIR",
];
if (process.env.DJL_FINANCE_E2E !== "1" || required.some((key) => !process.env[key])) {
  console.error("Finance browser test requires explicit opt-in and disposable PostgreSQL/Redis.");
  process.exit(1);
}

const web = fileURLToPath(new URL("../", import.meta.url));
const api = fileURLToPath(new URL("../../api/", import.meta.url));
const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const scratchRoot = realpathSync(tmpdir());
const dir = mkdtempSync(join(scratchRoot, "djl-finance-browser-"));
const path = (name) => join(dir, name);
const read = (name) => JSON.parse(readFileSync(path(name), "utf8"));
const allow = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "SystemDrive",
  "ComSpec",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
  "PLAYWRIGHT_BROWSERS_PATH",
];
const env = Object.fromEntries(
  allow.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
);
Object.assign(env, {
  CI: "1",
  NO_COLOR: "1",
  DO_NOT_TRACK: "1",
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  DJL_FINANCE_E2E: "1",
  DJL_FINANCE_E2E_DIR: dir,
});

function run(exe, args, cwd, extra) {
  const child = spawn(exe, args, {
    cwd,
    env: { ...env, ...extra },
    windowsHide: true,
    stdio: "ignore",
    shell: false,
  });
  let done = false;
  const exit = new Promise((resolve) => {
    child.once("error", () => {
      done = true;
      resolve(null);
    });
    child.once("close", (code) => {
      done = true;
      resolve(code);
    });
  });
  return { child, exit, done: () => done };
}

let fixture;
let browserPassed = false;
let verified = false;
let result;
let phase = "start disposable API fixture";
try {
  fixture = run(
    "bun",
    ["--no-env-file", "--no-install", "src/testing/financeBrowserFixture.ts"],
    api,
    Object.fromEntries(required.map((key) => [key, process.env[key]])),
  );
  const deadline = Date.now() + 90_000;
  while (!fixture.done() && !existsSync(path("ready.json")) && Date.now() < deadline)
    await delay(100);
  const ready = read("ready.json");
  if (
    fixture.done() ||
    ready.pid !== fixture.child.pid ||
    ready.apiOrigin !== "http://localhost:48787" ||
    ready.adminOrigin !== "http://localhost:48731"
  )
    throw new Error("Invalid fixture readiness");

  phase = "run isolated Chromium scenario";
  const chromium = process.env.DJL_FINANCE_E2E_CHROMIUM;
  const browser = run(
    process.execPath,
    [cli, "test", "--config", "playwright.finance.config.ts"],
    web,
    {
      DJL_FINANCE_E2E_FIXTURE_PID: String(fixture.child.pid),
      ...(chromium ? { DJL_FINANCE_E2E_CHROMIUM: chromium } : {}),
    },
  );
  browserPassed = (await browser.exit) === 0;
} catch {
  // Never log Playwright locator calls, credentials, URLs containing secrets, or raw responses.
} finally {
  if (fixture) {
    try {
      if (!fixture.done())
        writeFileSync(path("stop"), browserPassed ? "verify" : "cleanup", { flag: "wx" });
      const code = await fixture.exit;
      if (browserPassed) phase = "verify test ledger and dispose fixture";
      result = read("result.json");
      verified =
        browserPassed &&
        code === 0 &&
        result.status === "verified" &&
        result.apiClosed &&
        result.databaseDropped &&
        result.blockedFetches === 0;
    } catch {
      verified = false;
    }
  }
  const stage =
    !browserPassed && existsSync(path("browser-stage"))
      ? readFileSync(path("browser-stage"), "utf8").trim()
      : result?.stage;
  if (verified) {
    console.log("Finance browser scenario passed; ledger verified and fixture disposed.");
    const { balancedTestJournals, ledgerRows, freshFinanceMfaSessions, wallet } = result.accounting;
    console.log(
      JSON.stringify({
        balancedTestJournals,
        ledgerRows,
        freshFinanceMfaSessions,
        paidTestCents: wallet.paidCents,
        recoveryCents: wallet.recoveryCents,
      }),
    );
  } else
    console.error(
      `Finance browser scenario failed: ${phase}${/^[a-z][a-z0-9-]{0,47}$/.test(stage ?? "") ? " (" + stage + ")" : ""}.`,
    );
  // Remove only the directory allocated by this invocation, never an externally supplied path.
  const actual = realpathSync(dir);
  if (actual === dir && actual.startsWith(scratchRoot + sep + "djl-finance-browser-")) {
    rmSync(actual, { recursive: true });
  }
  process.exitCode = verified ? 0 : 1;
}

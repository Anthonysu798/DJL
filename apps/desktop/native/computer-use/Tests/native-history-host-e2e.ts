// Owned fixtures only: real manager -> fd3 helper -> durable store -> authorized reader.
// Run the Node-target bundle after building the dedicated native history fixtures.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { ComputerUseManager } from "../../../src/computerUseManager";
import type { ComputerUseRequest, ComputerActivityPage } from "@synara/contracts";

const directory = mkdtempSync("/private/tmp/djl-history-host-e2e-");
const fixtureDirectory = "/private/tmp/djl-cua-history-fixture";
const fixturePath = join(fixtureDirectory, "History Fixture.app/Contents/MacOS/HistoryFixture");
const helperPath =
  "/private/tmp/djl-cua-history-build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse";
const probePath = "/private/tmp/djl-cua-history-inert/environment-probe";
const bundleId = "com.djl.history-fixture";
const probe = () =>
  JSON.parse(execFileSync(probePath, { encoding: "utf8", timeout: 2_000 })) as {
    pid: number;
    bundle: string;
    prohibited: boolean;
    cursorX: number;
    cursorY: number;
  };
assert.equal(probe().prohibited, false, "abort before fixture launch on secure/system foreground");
for (const name of ["command.json", "state.json"]) {
  const file = join(fixtureDirectory, name);
  if (existsSync(file)) unlinkSync(file);
}
// This disposable process never enables native input or provider processing.
delete process.env.DJL_COMPUTER_USE_EXPERIMENTAL_INPUT;
const fixture = spawn(fixturePath, [], { stdio: "ignore" });
const fixtureExit = new Promise((resolve) =>
  fixture.once("exit", (code, signal) => resolve({ code, signal })),
);
const manager = new ComputerUseManager({
  helperPath,
  historyDirectory: join(directory, "history"),
});
let sequence = 0,
  nativePid: number | undefined,
  nativeExit: Promise<unknown> | undefined;
let failure: unknown;
const checks: Record<string, unknown> = {};
const settings = {
  enabled: true,
  paused: false,
  interactionCaptureEnabled: true,
  semanticSummariesEnabled: false,
  retentionDays: 1,
  intervalSeconds: 30,
  includedBundleIds: [bundleId],
  includedDomains: [],
  excludedBundleIds: [],
  excludedDomains: [],
};
const state = () =>
  JSON.parse(readFileSync(join(fixtureDirectory, "state.json"), "utf8")) as {
    pid: number;
    sequence: number;
    windowTitle: string;
    windowId: number;
    text: string;
  };
function owned() {
  assert.equal(state().pid, fixture.pid, "fixture identity must remain exact");
  const current = probe();
  assert(
    !current.prohibited && current.pid === fixture.pid && current.bundle === bundleId,
    "abort: foreground left the owned fixture",
  );
  return current;
}
async function until<T>(
  read: () => Promise<T> | T,
  accepts: (value: T) => boolean,
  message: string,
  timeout = 10_000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (accepts(value)) return value;
    await delay(100);
  }
  throw Error(message);
}
async function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error("owned cleanup deadline")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function request(
  input: ComputerUseRequest,
  origin: "renderer" | "agent" = "renderer",
  thread = "host-history-fixture",
) {
  const response = await manager.request(thread, input, { origin });
  if ("error" in response) throw Error(`${input.method}: ${response.error.code}`);
  return response;
}
async function page(): Promise<ComputerActivityPage> {
  owned();
  const response = await request({ method: "activity.list", bundleId, limit: 200 });
  assert(response.method === "activity.list" && "result" in response);
  return response.result;
}
async function command(command: string, extra = {}) {
  owned();
  writeFileSync(
    join(fixtureDirectory, "command.json"),
    JSON.stringify({ sequence: ++sequence, command, ...extra }),
  );
  await until(
    () => {
      owned();
      return state();
    },
    (value) => value.sequence === sequence,
    "fixture command acknowledgement",
  );
}
try {
  await until(
    () =>
      existsSync(join(fixtureDirectory, "state.json")) &&
      state().pid === fixture.pid &&
      probe().pid === fixture.pid,
    Boolean,
    "fixture startup and owned foreground",
  );
  const initial = owned();
  const mainWindowId = state().windowId;
  await manager.start();
  const defaults = await request({ method: "history.settings" });
  assert(defaults.method === "history.settings" && "result" in defaults);
  assert.equal(defaults.result.interactionCaptureEnabled ?? false, false);
  assert.equal(defaults.result.semanticSummariesEnabled ?? false, false);
  const before = await page();
  assert.equal(before.events?.length ?? 0, 0);
  const deniedConfig = await manager.request(
    "untrusted-agent",
    { method: "history.configure", settings },
    { origin: "agent" },
  );
  assert("error" in deniedConfig && deniedConfig.error.code === "permission-denied");
  await request({ method: "history.configure", settings });
  const status = await request({ method: "status" });
  assert(status.method === "status" && "result" in status);
  assert.equal(status.result.permissions.accessibility, "granted");
  // Inspect only this manager's owned child handle; do not replace default spawning.
  const native = Reflect.get(manager, "helper") as ReturnType<typeof spawn> | undefined;
  assert(native?.pid, "real default-spawned helper is required");
  nativePid = native.pid;
  nativeExit = new Promise((resolve) =>
    native.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const nativeRows: Record<string, unknown>[] = [];
  checks.nativeRows = nativeRows;
  const decoder = new StringDecoder("utf8");
  let diagnosticBuffer = "";
  (native.stdio[3] as Readable).on("data", (chunk: Buffer) => {
    diagnosticBuffer += decoder.write(chunk);
    if (Buffer.byteLength(diagnosticBuffer) > 1024 * 1024) {
      diagnosticBuffer = "";
      return;
    }
    let end: number;
    while ((end = diagnosticBuffer.indexOf("\n")) >= 0) {
      const line = diagnosticBuffer.slice(0, end);
      diagnosticBuffer = diagnosticBuffer.slice(end + 1);
      if (nativeRows.length >= 200) continue;
      try {
        const frame = JSON.parse(line).event;
        nativeRows.push({
          type: frame?.type,
          state: frame?.state,
          kind: frame?.record?.kind,
          axMode: frame?.record?.ax?.mode,
          bytes: Buffer.byteLength(line),
        });
      } catch {
        nativeRows.push({ diagnosticFrameInvalid: true });
      }
    }
  });
  await until(
    page,
    (value) =>
      value.interactionStatus?.state === "observing" &&
      (value.events ?? []).some(
        (event) =>
          event.target.pid === fixture.pid &&
          event.target.windowId === mainWindowId &&
          event.ax?.mode === "full" &&
          event.ax.text.includes("alpha beta gamma") &&
          event.ax.text.includes("Synthetic history evidence"),
      ),
    "real fd3 recording and host ingest",
  );
  const text = "DJL host fixture decided to review before publishing. secret=synthetic-secret-123";
  await command("text", { text });
  const recorded = await until(
    page,
    (value) =>
      (value.events ?? []).some(
        (event) =>
          event.target.pid === fixture.pid &&
          event.target.windowId === mainWindowId &&
          event.ax?.mode === "diff" &&
          event.ax.text.includes("review before publishing"),
      ),
    "native context must reach host store",
  );
  assert(
    !JSON.stringify(recorded).includes("synthetic-secret-123"),
    "redaction must survive host persistence",
  );
  assert(
    (recorded.events ?? []).every(
      (event) => event.target.bundleId === bundleId && event.target.pid === fixture.pid,
    ),
  );
  assert((recorded.events ?? []).some((event) => event.ax?.mode === "full"));
  const deniedRead = await manager.request(
    "history-reader",
    { method: "activity.list" },
    { origin: "agent" },
  );
  assert("error" in deniedRead && deniedRead.error.code === "permission-denied");
  manager.resumeThread("history-reader", { allowActivityHistory: true });
  const allowedRead = await request(
    { method: "activity.list", bundleId, limit: 200 },
    "agent",
    "history-reader",
  );
  assert(
    allowedRead.method === "activity.list" &&
      "result" in allowedRead &&
      (allowedRead.result.events?.length ?? 0) > 0,
  );
  const deniedPrivate = await manager.request(
    "host-history-fixture",
    { method: "activity.observe", epoch: "forged", settings },
    { origin: "renderer" },
  );
  assert("error" in deniedPrivate && deniedPrivate.error.code === "permission-denied");
  await request({ method: "history.configure", settings: { ...settings, paused: true } });
  const paused = await until(
    page,
    (value) => value.interactionStatus?.state === "inactive",
    "pause must stop real observation",
  );
  const pausedIds = (paused.events ?? []).map((event) => event.id);
  await command("text", { text: "this paused edit must never be recorded" });
  await delay(1_000);
  assert.deepEqual((await page()).events?.map((event) => event.id) ?? [], pausedIds);
  const cleared = await request({ method: "activity.clear", bundleId });
  assert(
    cleared.method === "activity.clear" && "result" in cleared && cleared.result.deletedCount > 0,
  );
  assert.equal((await page()).events?.length ?? 0, 0);
  assert.equal(statSync(join(directory, "history", "activity")).mode & 0o777, 0o700);
  const final = owned();
  assert.equal(final.cursorX, initial.cursorX);
  assert.equal(final.cursorY, initial.cursorY);
  checks.defaultConsentsOff = true;
  checks.realNativeFd3ToDurableStore = true;
  checks.exactMainWindowFullAndDiff = mainWindowId;
  checks.redaction = true;
  checks.hostReaderGrant = true;
  checks.privateObserveDenied = true;
  checks.pauseNoLateEvents = true;
  checks.scopedClear = true;
  checks.physicalCursorUnchanged = true;
  checks.recordedKinds = [...new Set((recorded.events ?? []).map((event) => event.kind))];
  checks.recordedCount = recorded.events?.length;
} catch (error) {
  failure = error;
  try {
    const last = await page();
    checks.lastInteractionStatus = last.interactionStatus;
    checks.lastEventKinds = last.events?.map((event) => ({
      kind: event.kind,
      axMode: event.ax?.mode,
    }));
  } catch {
    /* An unexpected foreground abort must not inspect other applications. */
  }
} finally {
  try {
    await bounded(manager.dispose(), 10_000);
  } catch (error) {
    failure ??= error;
  }
  if (nativeExit) {
    try {
      checks.nativeExit = await bounded(nativeExit, 8_000);
    } catch (error) {
      failure ??= error;
    }
  }
  if (fixture.exitCode === null && fixture.signalCode === null) {
    if (existsSync(join(fixtureDirectory, "state.json")) && state().pid === fixture.pid)
      writeFileSync(
        join(fixtureDirectory, "command.json"),
        JSON.stringify({ sequence: ++sequence, command: "quit" }),
      );
    else fixture.kill("SIGTERM");
  }
  try {
    checks.fixtureExit = await bounded(fixtureExit, 5_000);
  } catch (error) {
    failure ??= error;
    fixture.kill("SIGTERM");
    try {
      checks.fixtureExit = await bounded(fixtureExit, 2_000);
    } catch {
      fixture.kill("SIGKILL");
      checks.fixtureExit = await bounded(fixtureExit, 2_000);
    }
  }
  const report = {
    passed: !failure,
    directory,
    nativePid,
    fixturePid: fixture.pid,
    checks,
    ...(failure ? { error: String(failure) } : {}),
  };
  writeFileSync(join(directory, "results.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
if (failure) throw failure;

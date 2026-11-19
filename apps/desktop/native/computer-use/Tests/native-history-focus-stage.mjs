// Exactly one staged Tab; controlled disposable OS branch evidence, never a natural-timing claim.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const mode = process.argv.find((x) => x.startsWith("--case="))?.slice(7) ?? "positive";
assert(
  ["positive", "old-credential", "new-credential", "extra-focus", "stop", "private"].includes(mode),
);
const audit = process.argv.includes("--audit"),
  fixtureDir = "/private/tmp/djl-cua-history-fixture";
const toolDir = "/private/tmp/djl-cua-history-inert";
const build = process.argv.includes("--retirement")
  ? "/private/tmp/djl-cua-focus-stage-retirement"
  : "/private/tmp/djl-cua-focus-stage-" + (audit ? "audit" : "normal");
const evidence = build + "/acceptance-" + randomUUID();
mkdirSync(evidence);
const arm = "/private/tmp/djl-cua-focus-stage-arm.json";
const probe = () => JSON.parse(execFileSync(toolDir + "/environment-probe", { encoding: "utf8" }));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
assert(!probe().prohibited, "abort system/security foreground");
for (const file of [arm, fixtureDir + "/command.json", fixtureDir + "/state.json"])
  if (existsSync(file)) unlinkSync(file);
const fixture = spawn(fixtureDir + "/History Fixture.app/Contents/MacOS/HistoryFixture", [], {
  stdio: "ignore",
});
const rows = [],
  stderr = [],
  stages = [],
  pending = new Map();
let helper,
  driver,
  driverReady = false,
  tapReady = false,
  sequence = 0,
  dispatches = 0,
  action,
  stageError,
  baseline,
  stagePosition,
  stageAt,
  stageErrorOffset = 0,
  stopPromise,
  stopSent = false;
const driverTrace = [];
const epoch = randomUUID();
const settings = {
  enabled: true,
  paused: false,
  interactionCaptureEnabled: true,
  retentionDays: 7,
  intervalSeconds: 30,
  includedBundleIds: ["com.djl.history-fixture"],
  excludedBundleIds: [],
  excludedDomains: [],
};
const state = () => JSON.parse(readFileSync(fixtureDir + "/state.json", "utf8"));
function owned() {
  const p = probe();
  assert(
    !p.prohibited && p.pid === fixture.pid && p.bundle === "com.djl.history-fixture",
    "abort foreground left fixture",
  );
  assert.equal(state().pid, fixture.pid);
  return p;
}
function records(position = 0) {
  return rows
    .slice(position)
    .filter((x) => x.event?.type === "activity-record" && x.event.epoch === epoch)
    .map((x) => x.event.record);
}
function request(request) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("request timeout"));
    }, 8000);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    helper.stdin.write(JSON.stringify({ id, threadId: "desktop:recorder", request }) + "\n");
  });
}
async function waitFor(predicate, label, bound = 3000) {
  const deadline = Date.now() + bound;
  while (!predicate() && Date.now() < deadline) {
    if (stageError) throw stageError;
    await delay(100);
    owned();
  }
  assert(predicate(), label);
}
try {
  for (let i = 0; i < 50 && !existsSync(fixtureDir + "/state.json"); i++) await delay(100);
  assert(existsSync(fixtureDir + "/state.json"), "bounded fixture readiness");
  await delay(500);
  const original = owned();
  writeFileSync(
    fixtureDir + "/command.json",
    JSON.stringify({
      sequence: ++sequence,
      command: mode === "positive" || mode === "stop" ? "two-fields" : "stage-fields",
    }),
  );
  await waitFor(() => state().sequence === sequence, "two ordinary fields");
  assert.equal(state().fieldAText, "alpha");
  assert.equal(state().fieldBText, "beta");
  const window = state().windowId;
  helper = spawn(build + "/DJL Computer Use.app/Contents/MacOS/DJLComputerUse", [], {
    stdio: ["pipe", "pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      DJL_CUA_ACTIVITY_FD: "3",
    },
  });
  createInterface({ input: helper.stdout }).on("line", (line) => {
    const r = JSON.parse(line);
    pending.get(r.id)?.(r.response);
    pending.delete(r.id);
  });
  createInterface({ input: helper.stdio[3] }).on("line", (line) => rows.push(JSON.parse(line)));
  createInterface({ input: helper.stderr }).on("line", (line) => {
    stderr.push(line);
    if (
      mode !== "positive" &&
      !stopSent &&
      ((mode === "stop" && line.startsWith("fixture-stage-input sequence=1 ")) ||
        line === "fixture-stage-retired")
    ) {
      stopSent = true;
      driverTrace.push("test-stop-request " + line);
      stopPromise = request({ method: "stop" }).catch((error) => {
        stageError = error;
      });
    }
    if (line.startsWith("fixture-stage-tap-ready ")) {
      tapReady = line.includes("valid=1 enabled=1");
      return;
    }
    if (!line.startsWith("fixture-stage {")) return;
    const item = JSON.parse(line.slice("fixture-stage ".length));
    stages.push(item);
    if (item.event === "ready") {
      try {
        assert.equal(dispatches, 0, "one stage and one dispatch only");
        assert(driverReady && tapReady);
        assert.equal(state().windowId, window);
        stagePosition = rows.length;
        stageAt = Date.now();
        stageErrorOffset = stderr.length;
        dispatches++;
        driverTrace.push("controller-go " + process.hrtime.bigint().toString());
        driver.stdin.end("dispatch-tab\n");
      } catch (error) {
        stageError = error;
      }
    }
  });
  assert.equal(
    (await request({ method: "activity.observe", epoch, settings })).result.observing,
    true,
  );
  await waitFor(
    () =>
      records().some((r) => r.selection?.text === "alpha") &&
      records().some((r) => r.ax?.mode === "full"),
    "real A baseline before stage",
    6000,
  );
  baseline = records();
  await waitFor(() => tapReady, "actual installed valid enabled tap");
  owned();
  if (!["positive", "stop"].includes(mode)) {
    writeFileSync(
      fixtureDir + "/command.json",
      JSON.stringify({ sequence: ++sequence, command: "stage-" + mode }),
    );
    await waitFor(() => state().sequence === sequence, "arm only the next real Tab effect");
    assert.equal(state().stageEffects, 0);
  }
  driver = spawn(build + "/staged-tab-driver", [String(fixture.pid), String(window), "tab"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  createInterface({ input: driver.stdout }).on("line", (line) => {
    driverTrace.push(line);
    if (line === "fixture-driver-ready") driverReady = true;
    else {
      try {
        action = JSON.parse(line);
      } catch {
        stageError = Error("unexpected staged driver output");
      }
    }
  });
  createInterface({ input: driver.stderr }).on("line", (line) => driverTrace.push(line));
  await waitFor(() => driverReady, "prestarted fixed Tab driver ready");
  owned();
  writeFileSync(arm, JSON.stringify({ pid: fixture.pid, window, epoch }));
  if (mode === "positive") {
    await waitFor(
      () => stages.some((x) => x.event === "reset"),
      "one completed continuation within original deadline",
      3000,
    );
    assert.equal(dispatches, 1);
    assert.equal(
      stderr.filter((x) => x.startsWith("fixture-stage-tap-ready ")).length,
      1,
      "same installed tap, no replacement",
    );
    assert.equal(stages.filter((x) => x.event === "consumed").length, 1);
    assert.equal(stages.filter((x) => x.event === "accepted").length, 1);
    const fence = stages.find((x) => x.event === "wait-end");
    assert.equal(fence.inputDelta, 1);
    assert.equal(fence.focusDelta, 1);
    assert(fence.waitNs <= 100_000_000, "measured synchronization <=100ms");
    assert(
      stages.some((x) => x.event === "pre-valid") &&
        stages.some((x) => x.event === "post-valid") &&
        !stages.some((x) => x.event === "post-invalid"),
    );
    await waitFor(() => driver.exitCode !== null, "single driver exits");
    assert.equal(driver.exitCode, 0);
    assert(action?.kind === "tab");
    for (const name of ["ready", "stage-end", "mismatch", "consumed", "accepted", "reset"])
      assert(stages.find((x) => x.event === name)?.remainingNs > 0, name + " within original750ms");
    const subjects = stderr
      .filter((x) => x.startsWith("fixture-stage-subject "))
      .map((line) =>
        Object.fromEntries(
          [...line.matchAll(/(generation|sequence|old|new|app|root|overflow)=(\d+)/g)].map((m) => [
            m[1],
            Number(m[2]),
          ]),
        ),
      );
    assert.equal(subjects.length, 2, "two actual retained notification facts required");
    assert.equal(subjects[0].root, 1);
    assert.equal(subjects[0].new, 0);
    assert.equal(subjects[1].new, 1);
    assert.equal(subjects[1].root, 0);
    assert.equal(subjects[0].sequence, 1);
    assert.equal(subjects[1].sequence, 1);
    assert.equal(subjects[1].generation, subjects[0].generation + 1);
    const matching = records(stagePosition).filter(
      (r) =>
        r.kind === "shortcut" &&
        r.keyEquivalent === "Tab" &&
        r.target.pid === fixture.pid &&
        r.target.windowId === window &&
        Date.parse(r.capturedAt) >= stageAt,
    );
    assert.equal(matching.length, 1);
    const tab = matching[0];
    assert.equal(tab.appName, "");
    assert.equal(tab.windowTitle, "");
    assert.equal(tab.ax, undefined);
    assert.equal(tab.text, undefined);
    assert.equal(tab.selection, undefined);
    assert(
      !stderr.some((x) => x.startsWith("fixture-stage-forbidden")),
      "no recovery emit or AX continuity preparation",
    );
    if (audit)
      assert(
        !stderr.some((x) => x.startsWith("fixture-stage-read editable=1")),
        "no old/new value or selection attempts",
      );
    await waitFor(() => state().fieldBFocused, "OS B focus");
    assert.equal(state().fieldBText, "beta");
    await delay(1300);
    owned();
    assert(
      !records(stagePosition).some((r) => r.kind === "text-input" && r.text === "beta"),
      "no false B typing",
    );
    const position = rows.length,
      at = Date.now();
    const typed = JSON.parse(
      execFileSync(toolDir + "/input-driver", [String(fixture.pid), String(window), "text"], {
        encoding: "utf8",
      }),
    );
    await waitFor(
      () =>
        records(position).some(
          (r) => r.kind === "text-input" && r.text === "Z" && Date.parse(r.capturedAt) >= at,
        ),
      "single genuine edit after B baseline",
      2500,
    );
    assert.equal(state().fieldBText, "Z");
    assert.equal(
      stderr.filter((x) => x.startsWith("fixture-stage-tap-ready ")).length,
      1,
      "same healthy attachment through B edit",
    );
    const last = owned();
    assert.equal(last.cursorX, original.cursorX);
    assert.equal(last.cursorY, original.cursorY);
    writeFileSync(
      evidence + "/result.json",
      JSON.stringify(
        {
          passed: true,
          audit,
          epoch,
          fixturePid: fixture.pid,
          helperPid: helper.pid,
          window,
          dispatches,
          action,
          driverTrace,
          typed,
          tab,
          stages,
          baseline,
          rows,
          stderr,
          state: state(),
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: true, audit, evidence, stages, tab }));
  } else {
    await waitFor(() => stderr.includes("fixture-stage-retired"), "failed attempt retires", 3000);
    if (stopPromise) await stopPromise;
    await waitFor(() => driver.exitCode !== null, "one negative-case driver exits");
    assert.equal(driver.exitCode, 0);
    assert.equal(dispatches, 1);
    assert.equal(action?.kind, "tab");
    await delay(300);
    owned();
    assert.equal(
      records(stagePosition).length,
      0,
      "no failed-attempt or late record after cooperative Stop",
    );
    assert(
      !stages.some((x) => x.event === "accepted" || x.event === "reset"),
      "negative never accepted",
    );
    assert(
      !stderr.some((x) => x.startsWith("fixture-stage-forbidden")),
      "no ordinary emit/continuity fallthrough during recovery",
    );
    if (audit)
      assert(
        !stderr.some((x) => x.startsWith("fixture-stage-read editable=1")),
        "no field/selection attempts in failed reader",
      );
    if (["old-credential", "new-credential"].includes(mode))
      assert.equal(
        stages.filter((x) => x.event === "consumed").length,
        1,
        "pair actually reaches fresh endpoint proof",
      );
    if (mode === "old-credential") assert.equal(state().fieldAIdentifier, "password");
    if (mode === "new-credential") assert.equal(state().fieldBIdentifier, "api-key");
    if (mode === "private") assert.equal(state().windowTitle, "Private Window");
    if (mode === "extra-focus")
      assert(
        stderr.slice(stageErrorOffset).filter((x) => x.startsWith("fixture-stage-callback "))
          .length >= 3,
        "real extra notification must be delivered",
      );
    if (mode !== "stop")
      assert.equal(
        state().stageEffects,
        1,
        "one actual Tab applied exactly one armed fixture effect",
      );
    assert.equal(state().fieldBText, "beta");
    assert(state().fieldBFocused, "actual final B focus");
    const last = owned();
    assert.equal(last.cursorX, original.cursorX);
    assert.equal(last.cursorY, original.cursorY);
    writeFileSync(
      evidence + "/result.json",
      JSON.stringify(
        {
          passed: true,
          mode,
          audit,
          epoch,
          fixturePid: fixture.pid,
          helperPid: helper.pid,
          window,
          dispatches,
          action,
          driverTrace,
          stages,
          rows,
          stderr,
          state: state(),
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: true, mode, audit, evidence, stages }));
  }
} catch (error) {
  writeFileSync(
    evidence + "/failure.json",
    JSON.stringify(
      {
        error: String(error),
        mode,
        dispatches,
        action,
        driverTrace,
        stages,
        rows,
        stderr,
        state: existsSync(fixtureDir + "/state.json") ? state() : null,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (existsSync(arm)) unlinkSync(arm);
  if (driver && driver.exitCode === null) {
    driver.stdin.end();
    await delay(250);
    if (driver.exitCode === null) driver.kill("SIGTERM");
  }
  if (helper) {
    try {
      await request({ method: "stop" });
    } catch {}
    helper.stdin.end();
    await delay(500);
    if (helper.exitCode === null) helper.kill("SIGTERM");
  }
  writeFileSync(
    fixtureDir + "/command.json",
    JSON.stringify({ sequence: ++sequence, command: "quit" }),
  );
  await delay(500);
  if (fixture.exitCode === null) fixture.kill("SIGTERM");
  await delay(300);
  const cleanup = {
    driverPid: driver?.pid,
    driverExit: driver?.exitCode,
    driverSignal: driver?.signalCode,
    helperPid: helper?.pid,
    helperExit: helper?.exitCode,
    helperSignal: helper?.signalCode,
    fixturePid: fixture.pid,
    fixtureExit: fixture.exitCode,
    fixtureSignal: fixture.signalCode,
  };
  writeFileSync(evidence + "/cleanup.json", JSON.stringify(cleanup, null, 2));
  console.log(JSON.stringify({ evidence, cleanup }));
  assert(
    (!helper || helper.exitCode === 0) &&
      fixture.exitCode === 0 &&
      (!driver || driver.exitCode !== null || driver.signalCode !== null),
    "owned processes reaped cleanly",
  );
}

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const dir = "/private/tmp/djl-cua-history-fixture",
  evidence = "/private/tmp/djl-cua-history-inert";
const audit = process.argv.includes("--audit");
const helperPath =
  (audit ? "/private/tmp/djl-cua-history-audit/" : "/private/tmp/djl-cua-history-build/") +
  "DJL Computer Use.app/Contents/MacOS/DJLComputerUse";
const probe = () => JSON.parse(execFileSync(evidence + "/environment-probe", { encoding: "utf8" }));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
assert(!probe().prohibited, "abort system/security foreground");
for (const name of ["command.json", "state.json"])
  if (existsSync(dir + "/" + name)) unlinkSync(dir + "/" + name);
const fixture = spawn(dir + "/History Fixture.app/Contents/MacOS/HistoryFixture", [], {
  stdio: "ignore",
});
let helper,
  sequence = 0,
  epoch = randomUUID();
const rows = [],
  errors = [],
  results = [],
  pending = new Map();
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
const state = () => JSON.parse(readFileSync(dir + "/state.json", "utf8"));
function owned() {
  const p = probe();
  assert(
    !p.prohibited && p.pid === fixture.pid && p.bundle === "com.djl.history-fixture",
    "abort unexpected foreground",
  );
  return p;
}
function request(request) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("request timeout"));
    }, 8000);
    pending.set(id, (v) => {
      clearTimeout(timer);
      resolve(v);
    });
    helper.stdin.write(JSON.stringify({ id, threadId: "desktop:recorder", request }) + "\n");
  });
}
async function command(command) {
  owned();
  writeFileSync(dir + "/command.json", JSON.stringify({ sequence: ++sequence, command }));
  await delay(1600);
  owned();
  assert.equal(state().sequence, sequence);
}
function countPrivateReads(offset) {
  return (
    errors
      .slice(offset)
      .join("")
      .match(/fixture-read-under-private-title/g) || []
  ).length;
}
function newRecords(position) {
  return rows
    .slice(position)
    .filter((x) => x.event?.type === "activity-record" && x.event.epoch === epoch)
    .map((x) => x.event.record);
}
async function action(kind, predicate) {
  owned();
  const position = rows.length,
    at = Date.now(),
    windowId = state().windowId;
  execFileSync(evidence + "/input-driver", [String(fixture.pid), String(windowId), kind]);
  const deadline = Date.now() + 2500;
  let record;
  while (
    !(record = newRecords(position).find(
      (r) =>
        Date.parse(r.capturedAt) >= at &&
        r.target.pid === fixture.pid &&
        r.target.bundleId === "com.djl.history-fixture" &&
        r.target.windowId === windowId &&
        predicate(r),
    )) &&
    Date.now() < deadline
  ) {
    await delay(100);
    owned();
  }
  assert(record, "one dispatched " + kind + " requires fresh matching record within2500ms");
  return { position, at, record };
}
try {
  for (let i = 0; i < 50 && !existsSync(dir + "/state.json"); i++) await delay(100);
  assert(existsSync(dir + "/state.json"));
  await delay(500);
  const start = owned();
  helper = spawn(helperPath, [], {
    stdio: ["pipe", "pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      DJL_CUA_ACTIVITY_FD: "3",
    },
  });
  helper.stderr.on("data", (d) => errors.push(d.toString()));
  createInterface({ input: helper.stdout }).on("line", (line) => {
    const x = JSON.parse(line);
    pending.get(x.id)?.(x.response);
    pending.delete(x.id);
  });
  createInterface({ input: helper.stdio[3] }).on("line", (line) => rows.push(JSON.parse(line)));
  assert.equal(
    (await request({ method: "activity.observe", epoch, settings })).result.observing,
    true,
  );
  await delay(2200);
  owned();
  assert(
    rows.some((x) => x.event?.record?.ax),
    "initial normal context captured",
  );
  // P1: same attached window changes only its native title. Settle before checking subsequent passes.
  const titleStart = rows.length;
  await command("private-title");
  assert.equal(state().windowTitle, "Private Window");
  let position = rows.length,
    offset = errors.length;
  await delay(1300);
  owned();
  results.push({
    name: "title-only private subsequent passes deny before associated AXValue",
    reads: countPrivateReads(offset),
    records: newRecords(position).length,
    passed: (!audit || countPrivateReads(offset) === 0) && newRecords(position).length === 0,
  });
  // P1: a new lease attempts attachment while the same title-only private window is already present.
  epoch = randomUUID();
  position = rows.length;
  offset = errors.length;
  assert.equal(
    (await request({ method: "activity.observe", epoch, settings })).result.observing,
    true,
  );
  await delay(2200);
  owned();
  results.push({
    name: "title-only private initial attachment denies before associated AXValue",
    reads: countPrivateReads(offset),
    records: newRecords(position).length,
    passed: (!audit || countPrivateReads(offset) === 0) && newRecords(position).length === 0,
  });
  results.push({
    name: "private-title transition never emits private title content",
    passed: !JSON.stringify(rows.slice(titleStart)).includes("value=Private Window"),
  });
  await command("ordinary-title");
  const fieldsStart = rows.length;
  await command("two-fields");
  assert.equal(state().fieldAText, "alpha");
  assert.equal(state().fieldBText, "beta");
  const alpha = newRecords(fieldsStart).find((r) => r.selection?.text === "alpha");
  assert(alpha, "actual focused A baseline observed before Tab");
  const tab = await action("tab", (r) => r.kind === "shortcut" && r.keyEquivalent === "Tab");
  await delay(1200);
  owned();
  assert(state().fieldBFocused, "Tab actually focused ordinary field B");
  assert.equal(state().fieldBText, "beta", "Tab did not edit B");
  const falseTyping = newRecords(tab.position).filter(
    (r) => r.kind === "text-input" && r.text === "beta",
  );
  results.push({
    name: "Tab A alpha to unchanged B beta never invents typing",
    passed: falseTyping.length === 0,
    falseTyping,
    alpha,
    tab: tab.record,
  });
  // A real edit in the same now-baselined field must still produce text-input.
  const typed = await action("text", (r) => r.kind === "text-input" && r.text === "Z");
  assert.equal(state().fieldBText, "Z");
  results.push({
    name: "genuine edit in baselined B produces text-input",
    passed: true,
    record: typed.record,
  });
  const after = owned();
  assert.equal(after.cursorX, start.cursorX);
  assert.equal(after.cursorY, start.cursorY);
  writeFileSync(
    evidence + "/review-regressions" + (audit ? "-audit" : "") + ".json",
    JSON.stringify(
      { passed: results.every((x) => x.passed), results, rows, errors, state: state() },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
  assert(
    results.every((x) => x.passed),
    "review regression expectations",
  );
} catch (error) {
  writeFileSync(
    evidence + "/review-regressions-failure.json",
    JSON.stringify(
      {
        error: String(error),
        results,
        rows,
        errors,
        state: existsSync(dir + "/state.json") ? state() : null,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (helper) {
    try {
      await request({ method: "stop" });
    } catch {}
    helper.stdin.end();
    await delay(500);
    if (helper.exitCode === null) helper.kill("SIGTERM");
  }
  writeFileSync(dir + "/command.json", JSON.stringify({ sequence: ++sequence, command: "quit" }));
  await delay(500);
  if (fixture.exitCode === null) fixture.kill("SIGTERM");
  await delay(300);
  const cleanup = {
    helperPid: helper?.pid,
    helperExit: helper?.exitCode,
    helperSignal: helper?.signalCode,
    fixturePid: fixture.pid,
    fixtureExit: fixture.exitCode,
    fixtureSignal: fixture.signalCode,
  };
  writeFileSync(evidence + "/review-regressions-cleanup.json", JSON.stringify(cleanup, null, 2));
  assert(helper?.exitCode === 0 && fixture.exitCode === 0, "owned processes exit cleanly");
}

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = "/private/tmp/djl-cua-history-fixture",
  evidence = "/private/tmp/djl-cua-history-inert";
const probe = () => JSON.parse(execFileSync(evidence + "/environment-probe", { encoding: "utf8" }));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
assert(!probe().prohibited, "abort system/security foreground");
for (const file of ["state.json", "command.json"])
  if (existsSync(root + "/" + file)) unlinkSync(root + "/" + file);
const fixture = spawn(root + "/History Fixture.app/Contents/MacOS/HistoryFixture", [], {
  stdio: "ignore",
});
let helper,
  sequence = 0;
const rows = [],
  errors = [],
  pending = new Map();
const state = () => JSON.parse(readFileSync(root + "/state.json", "utf8"));
const owned = () => {
  const current = probe();
  assert(
    !current.prohibited &&
      current.pid === fixture.pid &&
      current.bundle === "com.djl.history-fixture",
    "abort unexpected foreground",
  );
};
function request(request) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error("request timeout"));
    }, 8000);
    pending.set(id, (v) => {
      clearTimeout(timeout);
      resolve(v);
    });
    helper.stdin.write(JSON.stringify({ id, threadId: "desktop:recorder", request }) + "\n");
  });
}
try {
  for (let i = 0; i < 50 && !existsSync(root + "/state.json"); i++) await delay(100);
  await delay(400);
  owned();
  helper = spawn(
    "/private/tmp/djl-cua-history-audit/DJL Computer Use.app/Contents/MacOS/DJLComputerUse",
    [],
    {
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        DJL_CUA_ACTIVITY_FD: "3",
      },
    },
  );
  helper.stderr.on("data", (x) => errors.push(x.toString()));
  createInterface({ input: helper.stdout }).on("line", (line) => {
    const x = JSON.parse(line);
    pending.get(x.id)?.(x.response);
    pending.delete(x.id);
  });
  const activity = createInterface({ input: helper.stdio[3] });
  activity.on("line", (line) => rows.push(JSON.parse(line)));
  const epoch = randomUUID(),
    settings = {
      enabled: true,
      paused: false,
      interactionCaptureEnabled: true,
      retentionDays: 7,
      intervalSeconds: 30,
      includedBundleIds: ["com.djl.history-fixture"],
      excludedBundleIds: [],
      excludedDomains: [],
    };
  assert.equal(
    (await request({ method: "activity.observe", epoch, settings })).result.observing,
    true,
  );
  await delay(900);
  owned();
  activity.pause();
  for (let i = 0; i < 180; i++) {
    if (i % 5 === 0) owned();
    writeFileSync(
      root + "/command.json",
      JSON.stringify({
        sequence: ++sequence,
        command: "text",
        text: String.fromCharCode(65 + (i % 20)).repeat(3500),
      }),
    );
    await delay(180);
    if ([...errors.join("").matchAll(/fixture-drop-count (\d+)/g)].length >= 2) break;
  }
  await delay(2200);
  owned();
  assert.equal(state().sequence, sequence);
  const dropCounts = [...errors.join("").matchAll(/fixture-drop-count (\d+)/g)].map((x) =>
    Number(x[1]),
  );
  assert(dropCounts.length > 0, "actual bounded queue loss required");
  const stoppedChangingAt = Date.now();
  activity.resume();
  await delay(600);
  owned();
  const finalDropCount = Math.max(
    ...[...errors.join("").matchAll(/fixture-drop-count (\d+)/g)].map((x) => Number(x[1])),
  );
  await delay(1800);
  owned();
  const observed = rows.filter(
    (x) =>
      x.event?.type === "activity-observer-status" &&
      x.event.epoch === epoch &&
      x.event.state === "observing",
  );
  assert.equal(
    observed.at(-1)?.event.droppedRecords,
    finalDropCount,
    "final short-burst count publishes without another loss",
  );
  assert.equal(
    Math.max(
      ...[...errors.join("").matchAll(/fixture-drop-count (\d+)/g)].map((x) => Number(x[1])),
    ),
    finalDropCount,
    "no later loss supplied an accidental flush",
  );
  const paused = randomUUID();
  assert.equal(
    (
      await request({
        method: "activity.observe",
        epoch: paused,
        settings: { ...settings, paused: true },
      })
    ).result.observing,
    false,
  );
  await delay(1300);
  assert(
    !rows.some(
      (x) =>
        x.event?.type === "activity-observer-status" &&
        x.event.epoch === paused &&
        x.event.state === "observing",
    ),
    "pause cannot resurrect observing",
  );
  writeFileSync(
    evidence + "/loss-flush-r1-e2e.json",
    JSON.stringify(
      {
        passed: true,
        finalDropCount,
        stoppedChangingAt,
        observed,
        statuses: rows.filter((x) => x.event?.type === "activity-observer-status"),
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      finalDropCount,
      observedFinal: observed.at(-1).event.droppedRecords,
    }),
  );
} catch (error) {
  writeFileSync(
    evidence + "/loss-flush-r1-failure.json",
    JSON.stringify({ error: String(error), rows, errors }, null, 2),
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
  writeFileSync(root + "/command.json", JSON.stringify({ sequence: ++sequence, command: "quit" }));
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
  writeFileSync(evidence + "/loss-flush-r1-cleanup.json", JSON.stringify(cleanup, null, 2));
  assert(!helper || helper.exitCode !== null || helper.signalCode !== null, "helper reaped");
  assert(fixture.exitCode !== null || fixture.signalCode !== null, "fixture reaped");
}

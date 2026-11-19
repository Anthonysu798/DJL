import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const dir = "/private/tmp/djl-cua-history-fixture",
  evidence = "/private/tmp/djl-cua-history-inert";
const helperPath =
  (process.argv.includes("--diagnose")
    ? "/private/tmp/djl-cua-history-trace/"
    : process.argv.includes("--audit")
      ? "/private/tmp/djl-cua-history-audit/"
      : "/private/tmp/djl-cua-history-build/") +
  "DJL Computer Use.app/Contents/MacOS/DJLComputerUse";
const fixturePath = dir + "/History Fixture.app/Contents/MacOS/HistoryFixture";
const probe = () => JSON.parse(execFileSync(evidence + "/environment-probe", { encoding: "utf8" }));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const before = probe();
assert(!before.prohibited, "abort: foreground system/security app");
mkdirSync(dir, { recursive: true });
for (const name of ["command.json", "state.json"])
  if (existsSync(dir + "/" + name)) unlinkSync(dir + "/" + name);
const fixture = spawn(fixturePath, [], { stdio: "ignore" });
let helper,
  secondary,
  sequence = 0;
const rows = [],
  responses = [],
  errors = [],
  commands = [],
  inputMatches = [],
  pending = new Map();
const settings = {
  enabled: true,
  paused: false,
  interactionCaptureEnabled: true,
  retentionDays: 7,
  intervalSeconds: 30,
  includedBundleIds: ["com.djl.history-fixture", "com.djl.history-fixture-secondary"],
  excludedBundleIds: [],
  includedDomains: [],
  excludedDomains: [],
};
const epoch = randomUUID();
function state() {
  return JSON.parse(readFileSync(dir + "/state.json", "utf8"));
}
function owned() {
  const now = probe();
  assert(
    !now.prohibited && now.pid === fixture.pid && now.bundle === "com.djl.history-fixture",
    "abort: foreground left owned fixture",
  );
  return now;
}
function request(request) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(Error("request timeout " + request.method));
    }, 8000);
    pending.set(id, (v) => {
      clearTimeout(timeout);
      resolve(v);
    });
    helper.stdin.write(JSON.stringify({ id, threadId: "desktop:recorder", request }) + "\n");
  });
}
async function command(command, extra = {}) {
  owned();
  commands.push({ command, at: Date.now() });
  writeFileSync(dir + "/command.json", JSON.stringify({ sequence: ++sequence, command, ...extra }));
  await delay(1600);
  owned();
  assert.equal(state().sequence, sequence);
}
try {
  for (let i = 0; i < 50 && !existsSync(dir + "/state.json"); i++) await delay(100);
  assert(existsSync(dir + "/state.json"), "fixture readiness");
  await delay(500);
  const start = owned();
  assert.equal(state().pid, fixture.pid);
  const beforeHelper = state();
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
  createInterface({ input: helper.stdout }).on("line", (l) => {
    const value = JSON.parse(l);
    responses.push(value);
    pending.get(value.id)?.(value.response);
    pending.delete(value.id);
  });
  createInterface({ input: helper.stdio[3] }).on("line", (l) => rows.push(JSON.parse(l)));
  const result = await request({ method: "activity.observe", epoch, settings });
  assert.equal(result.result?.observing, true, JSON.stringify(result));
  await delay(2200);
  owned();
  const afterInitialCapture = state();
  assert.equal(
    afterInitialCapture.protectedValueReads,
    beforeHelper.protectedValueReads,
    "native initial traversal adds no credential value reads",
  );
  if (process.argv.includes("--diagnose")) {
    await delay(2000);
    writeFileSync(
      evidence + "/diagnostic.json",
      JSON.stringify({ rows, responses, errors, beforeHelper, state: state() }, null, 2),
    );
    console.log("Owned diagnostic captured");
  } else if (process.argv.includes("--association-diagnose")) {
    await command("associated");
    await command("editor");
    await command("text", { text: "fixture restored after association" });
    writeFileSync(
      evidence + "/association-r1-diagnostic.json",
      JSON.stringify({ rows, responses, errors, commands, state: state() }, null, 2),
    );
    console.log("Owned association guard diagnostic captured");
  } else {
    await command("text", { text: "fixture edited alpha beta" });
    await command("selection");
    // One dispatch only; allow the existing 750ms capture pass to finish before changing fixture state.
    for (const kind of ["text", "key", "click", "right", "drag", "scroll"]) {
      owned();
      const position = rows.length,
        dispatchedAt = Date.now(),
        windowId = state().windowId;
      const dispatched = JSON.parse(
        execFileSync(evidence + "/input-driver", [String(fixture.pid), String(windowId), kind], {
          encoding: "utf8",
        }),
      );
      const expected = {
        text: "text-input",
        key: "shortcut",
        click: "click",
        right: "context-menu",
        drag: "drag",
        scroll: "scroll",
      }[kind];
      const matches = ({ event: e }) => {
        const r = e?.record;
        if (
          e?.type !== "activity-record" ||
          e.epoch !== epoch ||
          r.kind !== expected ||
          Date.parse(r.capturedAt) < dispatchedAt ||
          r.target?.pid !== fixture.pid ||
          r.target?.windowId !== windowId ||
          r.target?.bundleId !== "com.djl.history-fixture"
        )
          return false;
        if (kind === "text") return r.text === "Zre edited alpha beta";
        if (kind === "key") return r.keyEquivalent === "ArrowRight" && r.modifiers?.length === 0;
        if (kind === "scroll") return r.mouse?.deltaX === 6 && r.mouse?.deltaY === 15;
        return (
          r.mouse?.button === (kind === "right" ? "right" : "left") &&
          r.mouse.clickCount === 1 &&
          r.mouse.origin?.x === dispatched.x &&
          r.mouse.origin?.y === dispatched.y &&
          r.mouse.destination?.x === dispatched.x + (kind === "drag" ? 25 : 0) &&
          r.mouse.destination?.y === dispatched.y
        );
      };
      const deadline = Date.now() + 2500;
      let match;
      while (!(match = rows.slice(position).find(matches)) && Date.now() < deadline) {
        await delay(100);
        owned();
      }
      assert(
        match,
        "single dispatched " + kind + " must produce fresh matching record within 2500ms",
      );
      inputMatches.push({
        kind,
        position,
        dispatchedAt,
        dispatched,
        record: match.event.record.id,
      });
    }
    const pointerState = state();
    assert(
      pointerState.pointerDowns >= 3 &&
        pointerState.pointerUps >= 3 &&
        pointerState.pointerDrags >= 1 &&
        pointerState.pointerScrolls >= 1,
      "independent pointer fixture effects",
    );
    if (process.argv.includes("--input-diagnose")) {
      writeFileSync(
        evidence + "/input-age-r1-diagnostic.json",
        JSON.stringify({ rows, responses, errors, state: state() }, null, 2),
      );
      console.log("Owned input timing diagnostic captured");
    } else {
      await command("text", { text: "fixture secret=synthetic-value ordinary" });
      await command("cycle-label");
      const cycleStart = rows.length;
      await delay(1000);
      owned();
      assert(
        !rows.slice(cycleStart).some((x) => x.event?.type === "activity-record"),
        "true label cycle denies before label value",
      );
      await command("remove-cycle");
      await command("credential");
      const credentialStart = rows.length;
      await delay(1700);
      owned();
      assert(
        !rows.slice(credentialStart).some((x) => x.event?.type === "activity-record"),
        "credential focus suppressed",
      );
      await command("secure");
      const secureStart = rows.length;
      await delay(1700);
      owned();
      assert(
        !rows.slice(secureStart).some((x) => x.event?.type === "activity-record"),
        "secure focus suppressed",
      );
      await command("associated");
      const associatedStart = rows.length;
      await delay(1000);
      owned();
      assert(
        !rows.slice(associatedStart).some((x) => x.event?.type === "activity-record"),
        "associated credential label suppressed",
      );
      await command("excluded-focus");
      const descendantFocusStart = rows.length;
      await delay(1000);
      owned();
      assert(state().descendantIsFirstResponder, "real descendant focus required");
      assert(
        !rows.slice(descendantFocusStart).some((x) => x.event?.type === "activity-record"),
        "excluded descendant focus suppressed before indirect label read",
      );
      await command("editor");
      await command("text", { text: "fixture restored alpha beta" });
      assert(
        rows.some((x) => x.event?.record?.text === "fixture restored alpha beta"),
        "ordinary editor resumes with association retained",
      );
      await command("named-credential-subtree");
      const namedStart = rows.length;
      await delay(1000);
      owned();
      assert(state().descendantIsFirstResponder, "explicit credential descendant focused");
      assert(
        !rows.slice(namedStart).some((x) => x.event?.type === "activity-record"),
        "explicit credential ancestor stops indirect label read",
      );
      await command("editor");
      await command("excluded-web");
      const excludedWebStart = rows.length;
      await delay(1000);
      owned();
      assert(
        !rows.slice(excludedWebStart).some((x) => x.event?.type === "activity-record"),
        "excluded subtree unknown web still denies event",
      );
      await command("excluded-native");
      await command("web-unknown");
      const webStart = rows.length;
      await delay(1000);
      owned();
      assert(
        !rows.slice(webStart).some((x) => x.event?.type === "activity-record"),
        "unknown embedded web suppressed",
      );
      await command("web-remove");
      await command("second");
      await command("first");
      owned();
      const secondaryDir = "/private/tmp/djl-cua-history-fixture-secondary";
      for (const name of ["command.json", "state.json"])
        if (existsSync(secondaryDir + "/" + name)) unlinkSync(secondaryDir + "/" + name);
      secondary = spawn(
        secondaryDir + "/History Secondary.app/Contents/MacOS/HistoryFixture",
        ["--secondary"],
        { stdio: "ignore" },
      );
      await delay(2000);
      let secondFront = probe();
      assert(
        !secondFront.prohibited &&
          secondFront.pid === secondary.pid &&
          secondFront.bundle === "com.djl.history-fixture-secondary",
        "secondary fixture owns foreground",
      );
      writeFileSync(
        dir + "/command.json",
        JSON.stringify({ sequence: ++sequence, command: "activate" }),
      );
      await delay(1800);
      owned();
      writeFileSync(
        secondaryDir + "/command.json",
        JSON.stringify({ sequence: 1, command: "quit" }),
      );
      await delay(400);
      assert(secondary.exitCode !== null, "secondary fixture reaped");
      const pausedEpoch = randomUUID();
      const paused = await request({
        method: "activity.observe",
        epoch: pausedEpoch,
        settings: { ...settings, paused: true },
      });
      assert.equal(paused.result.observing, false);
      const pausedAt = rows.length;
      await command("text", { text: "after pause should not record" });
      assert(
        !rows.slice(pausedAt).some((x) => x.event?.type === "activity-record"),
        "pause emits no records",
      );
      const resumeEpoch = randomUUID();
      assert.equal(
        (await request({ method: "activity.observe", epoch: resumeEpoch, settings })).result
          .observing,
        true,
      );
      await delay(700);
      helper.stdio[3].destroy();
      await delay(500);
      assert.equal(
        (await request({ method: "activity.observe", epoch: resumeEpoch, settings })).result
          .observing,
        false,
        "dead activity pipe revokes capture",
      );
      assert(
        (await request({ method: "status" })).result.available,
        "stdout remains usable after activity pipe failure",
      );
      await request({ method: "stop" });
      const after = owned();
      const final = state();
      const records = rows
        .filter((x) => x.event?.type === "activity-record")
        .map((x) => x.event.record);
      const encoded = JSON.stringify(records);
      assert(records.length > 0, "real native records required");
      assert(
        records.some(
          (r) =>
            r.ax?.mode === "full" &&
            r.target.pid === fixture.pid &&
            r.target.windowId === beforeHelper.windowId,
        ),
        "actual main-window AX full required",
      );
      assert(
        records.some(
          (r) =>
            r.ax?.mode === "diff" &&
            r.target.pid === fixture.pid &&
            r.target.windowId === beforeHelper.windowId,
        ),
        "actual main-window AX diff required",
      );
      for (const kind of [
        "text-input",
        "shortcut",
        "click",
        "context-menu",
        "drag",
        "scroll",
        "app-changed",
      ])
        assert(
          records.some((r) => r.kind === kind),
          "actual input kind " + kind,
        );
      assert(
        records.some((r) => r.text === "fixture edited alpha beta"),
        "actual observed text required",
      );
      assert(
        records.some(
          (r) =>
            r.selection?.text === "fixtu" && r.selection.location === 0 && r.selection.length === 5,
        ),
        "actual selection and range required",
      );
      assert(
        !encoded.includes("synthetic-hidden-credential") &&
          !encoded.includes("synthetic-hidden-password") &&
          !encoded.includes("synthetic-hidden-descendant") &&
          !encoded.includes("synthetic-hidden-subtree-field") &&
          !encoded.includes("synthetic-hidden-linked-label") &&
          !encoded.includes("synthetic-hidden-cycle-label") &&
          !encoded.includes("synthetic-value"),
        "no secret payload",
      );
      assert(
        !records.some((r) => r.text === "synthetic-hidden-credential"),
        "credential focus must never emit its value",
      );
      assert.equal(after.cursorX, start.cursorX);
      assert.equal(after.cursorY, start.cursorY);
      if (process.argv.includes("--audit")) {
        assert(
          !errors.join("").includes("fixture-read-before-private-proof"),
          "no value before private proof",
        );
        assert(
          errors
            .join("")
            .includes(
              "fixture-excluded-scope id=fixture-associated-descendant parent=fixture-associated-subtree",
            ),
          "actual AX excluded ancestry required",
        );
      }
      if (process.argv.includes("--audit"))
        assert(
          !errors
            .join("")
            .match(
              /fixture-read-attempt AX(?:Value|SelectedText|SelectedTextRange) (?:api-key|password|fixture-cycle-label|fixture-associated(?:-(?:descendant|subtree|linked-label))?)/,
            ),
          "native attempted credential content read",
        );
      writeFileSync(
        evidence +
          (process.argv.includes("--audit") ? "/fixture-audit-e2e.json" : "/fixture-e2e.json"),
        JSON.stringify(
          {
            passed: true,
            before,
            start,
            after,
            beforeHelper,
            afterInitialCapture,
            final,
            records,
            responses,
            commands,
            inputMatches,
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
          records: records.length,
          kinds: [...new Set(records.map((x) => x.kind))],
          protectedValueReads: final.protectedValueReads,
        }),
      );
    }
  }
} catch (error) {
  writeFileSync(
    evidence + "/fixture-e2e-failure.json",
    JSON.stringify(
      {
        error: String(error),
        rows,
        responses,
        errors,
        fixtureState: existsSync(dir + "/state.json") ? state() : null,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (secondary && secondary.exitCode === null) {
    secondary.kill("SIGTERM");
    await delay(300);
  }
  if (helper) {
    try {
      await request({ method: "stop" });
    } catch {}
    helper.stdin.end();
    await delay(500);
    if (helper.exitCode === null) helper.kill("SIGTERM");
  }
  if (fixture.exitCode === null) {
    writeFileSync(dir + "/command.json", JSON.stringify({ sequence: ++sequence, command: "quit" }));
    await delay(400);
    if (fixture.exitCode === null) fixture.kill("SIGTERM");
  }
  await delay(300);
  const cleanup = {
    secondaryPid: secondary?.pid,
    secondaryExit: secondary?.exitCode,
    secondarySignal: secondary?.signalCode,
    helperPid: helper?.pid,
    helperExit: helper?.exitCode,
    helperSignal: helper?.signalCode,
    fixturePid: fixture.pid,
    fixtureExit: fixture.exitCode,
    fixtureSignal: fixture.signalCode,
  };
  writeFileSync(evidence + "/fixture-cleanup.json", JSON.stringify(cleanup, null, 2));
  assert(!helper || helper.exitCode !== null || helper.signalCode !== null, "helper reaped");
  assert(fixture.exitCode !== null || fixture.signalCode !== null, "fixture reaped");
}

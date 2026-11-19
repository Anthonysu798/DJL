// Controlled fixture only. Runs the real Work MCP -> authenticated broker ->
// native helper path; never sends input to personal apps or prompts for access.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ComputerUseManager } from "../../src/computerUseManager";
import { Effect, Exit, ManagedRuntime, Scope } from "effect";
import { ProjectId, ThreadId } from "@synara/contracts";

const source = dirname(new URL(import.meta.url).pathname);
const directory = mkdtempSync("/private/tmp/djl-computer-broker-e2e-");
const fixtureRoot = "/private/tmp/djl-cua-background-probe";
const fixtureBinary = join(
  fixtureRoot,
  "DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture",
);
const observer = join(source, ".build/HumanStateObserver");
const human = () => JSON.parse(execFileSync(observer, { encoding: "utf8", timeout: 5_000 })).human;
const activityOnly = process.argv.includes("--activity");
const input = process.argv.includes("--input");
assert.ok(
  !input || (!activityOnly && process.env.DJL_COMPUTER_USE_EXPERIMENTAL_INPUT === "1"),
  "Raw fixture mode requires the explicit input gate and cannot record activity",
);
const fixture = spawn(
  fixtureBinary,
  [activityOnly ? "--history-foreground" : "--self-deactivate"],
  { stdio: "ignore" },
);
const state = () => {
  const value = JSON.parse(readFileSync(join(fixtureRoot, "fixture-state.json"), "utf8"));
  assert.equal(value.pid, fixture.pid);
  assert.equal(value.bundleId, "com.djl.computer-use.background-fixture");
  return value;
};
const manager = new ComputerUseManager({
  helperPath: resolve(
    process.env.DJL_CUA_TEST_HELPER ??
      join(source, ".build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse"),
  ),
  historyDirectory: join(directory, "history"),
});
const endpoint = await manager.start();
process.env.DJL_COMPUTER_USE_BRIDGE_URL = endpoint.url;
process.env.DJL_COMPUTER_USE_BRIDGE_TOKEN = endpoint.token;
// Import after host setup: the server consumes and deletes these credentials.
const { WorkMcpServerLive } = await import("../../../server/src/work/Layers/WorkMcpServer");
const { WorkMcpServer } = await import("../../../server/src/work/Services/WorkMcpServer");
const runtime = ManagedRuntime.make(WorkMcpServerLive);
const scope = await Effect.runPromise(Scope.make("sequential"));
const checks: Record<string, unknown> = {};
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if (state().isActive === activityOnly && state().isKey === activityOnly) break;
    } catch {
      /* Fixture is starting. */
    }
    await delay(100);
  }
  assert.equal(state().isActive, activityOnly);
  assert.equal(state().isKey, activityOnly);
  const before = human();
  const server = await runtime.runPromise(Effect.service(WorkMcpServer));
  await Effect.runPromise(server.start.pipe(Scope.provide(scope)));
  const registration = await runtime.runPromise(
    server.registerSession({
      threadId: ThreadId.makeUnsafe("broker-fixture-owner"),
      projectId: ProjectId.makeUnsafe("broker-fixture-project"),
      authorizedRoot: directory,
      attachmentsRoot: directory,
    }),
  );
  let id = 0;
  const call = async (name: string, args: Record<string, unknown>, expectedError = false) => {
    const response = await fetch(registration.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${registration.bearerToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.result.isError, expectedError, JSON.stringify(body.result));
    return body.result;
  };
  const status = (await call("djl_computer_status", {})).structuredContent.result;
  assert.equal(status.permissions.accessibility, "granted");
  checks.status = status;
  if (activityOnly) {
    const settings = {
      enabled: true,
      paused: false,
      retentionDays: 1,
      intervalSeconds: 5,
      includedBundleIds: ["com.djl.computer-use.background-fixture"],
      includedDomains: [],
      excludedBundleIds: [],
      excludedDomains: [],
    };
    const configured = await manager.request(
      "desktop:settings",
      { method: "history.configure", settings },
      { origin: "renderer" },
    );
    assert.ok("result" in configured);
    let page: any;
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await manager.request(
        "desktop:settings",
        { method: "activity.list" },
        { origin: "renderer" },
      );
      assert.ok("result" in response);
      page = response.result;
      if (page.snapshots.length) break;
      await delay(200);
    }
    assert.equal(page.snapshots.length, 1, JSON.stringify(page));
    assert.equal(page.snapshots[0].target.pid, fixture.pid);
    assert.ok(page.snapshots[0].labels.length > 0);
    assert.ok(
      !JSON.stringify(page).includes("fixture-initial"),
      "Editable text must not be recorded",
    );
    assert.ok(page.summaries.some((summary: any) => summary.periodSeconds === 600));
    assert.ok(page.summaries.some((summary: any) => summary.periodSeconds === 21600));
    await manager.request(
      "desktop:settings",
      { method: "history.configure", settings: { ...settings, paused: true } },
      { origin: "renderer" },
    );
    await call("djl_computer_activity", {}, true);
    const { beginComputerUseTurn } = await import("../../../server/src/work/computerTurnLifecycle");
    assert.equal(
      await beginComputerUseTurn("broker-fixture-owner", { allowActivityHistory: true }),
      true,
    );
    const recorded = (await call("djl_computer_activity", {})).structuredContent.result;
    assert.equal(recorded.snapshots[0].id, page.snapshots[0].id);
    assert.equal(
      await beginComputerUseTurn("broker-fixture-owner", { allowActivityHistory: false }),
      true,
    );
    await call("djl_computer_activity", {}, true);
    await manager.request(
      "desktop:settings",
      { method: "history.configure", settings: { ...settings, enabled: false } },
      { origin: "renderer" },
    );
    const cleared = await manager.request(
      "desktop:settings",
      { method: "activity.clear" },
      { origin: "renderer" },
    );
    assert.deepEqual(cleared, { method: "activity.clear", result: { deletedCount: 1 } });
    assert.deepEqual(
      await manager.request(
        "desktop:settings",
        { method: "activity.list" },
        { origin: "renderer" },
      ),
      { method: "activity.list", result: { snapshots: [], summaries: [] } },
    );
    assert.equal(human().mouseX, before.mouseX);
    assert.equal(human().mouseY, before.mouseY);
    checks.passiveFixtureCaptured = true;
    checks.editableInputOmitted = true;
    checks.explicitTurnAuthorizationAndRevocation = true;
    checks.pauseDisableAndClear = true;
    checks.snapshotCount = page.snapshots.length;
    checks.onlyControlledFixtureAllowed = true;
    checks.testFixtureSelfActivated = true;
  } else {
    const current = state();
    const target = { bundleId: current.bundleId, pid: current.pid, windowId: current.windowId };
    const sessionId = (await call("djl_computer_open", { target })).structuredContent.result
      .sessionId;
    const observe = async (screenshot = false) =>
      call("djl_computer_observe", { sessionId, screenshot });
    let view = await observe(true);
    const image = view.content.find((item: any) => item.type === "image");
    assert.ok(image?.data && image.mimeType === "image/png");
    writeFileSync(join(directory, "fixture.png"), Buffer.from(image.data, "base64"), {
      mode: 0o600,
    });
    const reference = (predicate: (element: any) => boolean) => {
      const observation = view.structuredContent.result;
      const matches = observation.elements.filter(predicate);
      assert.equal(matches.length, 1);
      return {
        kind: "element",
        snapshotId: observation.snapshotId,
        elementId: matches[0].elementId,
      };
    };
    const count = state().buttonCount;
    await call("djl_computer_action", {
      sessionId,
      action: {
        type: "performAction",
        target: reference(
          (row) => row.role === "AXButton" && row.label === "Increment fixture counter",
        ),
        action: "press",
      },
    });
    await delay(150);
    assert.equal(state().buttonCount, count + 1);
    view = await observe();
    const value = "DJL broker 中文 café 🧪";
    await call("djl_computer_action", {
      sessionId,
      action: {
        type: "setValue",
        target: reference((row) => row.role === "AXTextField" && row.value === "fixture-initial"),
        value,
      },
    });
    await delay(150);
    assert.equal(state().text, value);
    view = await observe();
    assert.ok(view.structuredContent.result.elements.some((row: any) => row.value === value));
    let rawText: string | undefined;
    if (input) {
      const point = (name: string) => {
        const bounds = view.structuredContent.result.bounds;
        const global = state().points[name];
        return { kind: "point", x: global.x - bounds.x, y: global.y - bounds.y };
      };
      const raw = (action: Record<string, unknown>) =>
        call("djl_computer_action", { sessionId, action });
      const clicks = state().buttonCount;
      await raw({ type: "click", target: point("button") });
      await delay(150);
      assert.equal(state().buttonCount, clicks + 1);
      const scrolling = state();
      await raw({ type: "scroll", target: point("scroll"), deltaX: 0, deltaY: 100 });
      await delay(150);
      assert.ok(state().scrollCount > scrolling.scrollCount);
      assert.notEqual(state().scrollOffset, scrolling.scrollOffset);
      const drags = state().dragCount;
      await raw({ type: "drag", from: point("dragStart"), to: point("dragEnd"), durationMs: 300 });
      await delay(150);
      assert.equal(state().dragCount, drags + 1);
      view = await observe();
      await raw({
        type: "setValue",
        target: reference((row) => row.role === "AXTextField"),
        value: "",
      });
      await raw({ type: "click", target: point("text") });
      view = await observe();
      rawText = "MCP 中文 café 🧪Z";
      await raw({
        type: "type",
        target: reference((row) => row.role === "AXTextField"),
        text: rawText,
      });
      await delay(150);
      assert.equal(state().text, rawText);
      view = await observe();
      await raw({
        type: "pressKey",
        target: reference((row) => row.role === "AXTextField"),
        key: "Backspace",
      });
      await delay(150);
      assert.equal(state().text, rawText.slice(0, -1));
      checks.rawMcpObservedEffects = [
        "coordinateClick",
        "verticalScroll",
        "drag",
        "unicodeType",
        "Backspace",
      ];
    }
    const history = (await call("djl_computer_history", {})).structuredContent.result;
    assert.ok(history.events.some((event: any) => event.type === "action"));
    assert.ok(!JSON.stringify(history).includes(value));
    if (rawText) assert.ok(!JSON.stringify(history).includes(rawText));
    await call("djl_computer_stop", {});
    assert.equal(state().isActive, false);
    assert.equal(state().isKey, false);
    assert.deepEqual(human(), before);
    checks.workMcpNativeRoundTrip = true;
    checks.observedButtonAndUnicodeEffects = true;
    checks.mcpScreenshot = join(directory, "fixture.png");
    checks.actionHistoryContainsNoInput = true;
    checks.humanStatePreserved = true;
    checks.inactiveTargetPreserved = true;
  }
  checks.passed = true;
  writeFileSync(join(directory, "results.json"), JSON.stringify(checks, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ directory, ...checks }));
} finally {
  await Effect.runPromise(Scope.close(scope, Exit.void));
  await runtime.dispose();
  await manager.dispose();
  fixture.kill("SIGTERM");
}

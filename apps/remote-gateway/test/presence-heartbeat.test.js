// FILE: presence-heartbeat.test.js
// Purpose: Verifies the bridge heartbeat ticks only while running and the channel is ready.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/presence-heartbeat

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPresenceHeartbeat } = require("../src/presence-heartbeat");

function createFakeInterval() {
  let callback = null;
  return {
    setIntervalFn(fn) {
      callback = fn;
      return { unref() {} };
    },
    clearIntervalFn() {
      callback = null;
    },
    tick: () => callback?.(),
    isArmed: () => callback !== null,
  };
}

test("heartbeat sends a timestamped notification on every tick", () => {
  const timers = createFakeInterval();
  const sent = [];
  const heartbeat = createPresenceHeartbeat({
    ...timers,
    now: () => 1_700_000_000_000,
    send: (text) => sent.push(JSON.parse(text)),
  });

  heartbeat.start();
  timers.tick();
  timers.tick();

  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], {
    method: "djl/presence/heartbeat",
    params: { at: 1_700_000_000_000 },
  });
  assert.equal(heartbeat.isRunning(), true);
});

test("heartbeat skips ticks while the channel is not ready", () => {
  const timers = createFakeInterval();
  const sent = [];
  let ready = false;
  const heartbeat = createPresenceHeartbeat({
    ...timers,
    isReady: () => ready,
    send: (text) => sent.push(text),
  });

  heartbeat.start();
  timers.tick();
  ready = true;
  timers.tick();

  assert.equal(sent.length, 1);
});

test("start is idempotent and stop disarms the interval", () => {
  const timers = createFakeInterval();
  const heartbeat = createPresenceHeartbeat({ ...timers, send: () => {} });

  heartbeat.start();
  heartbeat.start();
  assert.equal(timers.isArmed(), true);
  heartbeat.stop();
  assert.equal(timers.isArmed(), false);
  assert.equal(heartbeat.isRunning(), false);
});

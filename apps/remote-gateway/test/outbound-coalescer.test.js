// FILE: outbound-coalescer.test.js
// Purpose: Verifies notification batching, delta merging, and ordering around responses.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/outbound-coalescer

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOutboundCoalescer } = require("../src/outbound-coalescer");

const chunk = (data) =>
  JSON.stringify({ method: "djl/terminal/event", params: { type: "output", data } });

function createFakeTimers() {
  let pending = null;
  return {
    setTimeoutFn(callback) {
      pending = callback;
      return 1;
    },
    clearTimeoutFn() {
      pending = null;
    },
    fire() {
      const callback = pending;
      pending = null;
      callback?.();
    },
    hasPending: () => pending !== null,
  };
}

const delta = (itemId, text) =>
  JSON.stringify({
    method: "item/agentMessage/delta",
    params: {
      threadId: "t",
      turnId: "u",
      itemId,
      delta: text,
      djlEmittedAt: "2026-09-04T10:00:00.000Z",
    },
  });

test("notifications inside one window are sent as one batch array", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(JSON.stringify({ method: "turn/started", params: { threadId: "t" } }));
  coalescer.push(
    JSON.stringify({ method: "item/plan/delta", params: { threadId: "t", delta: "x" } }),
  );
  assert.deepEqual(flushed, []);
  assert.equal(timers.hasPending(), true);

  timers.fire();
  assert.equal(flushed.length, 1);
  const batch = JSON.parse(flushed[0]);
  assert.deepEqual(
    batch.map((m) => m.method),
    ["turn/started", "item/plan/delta"],
  );
});

test("a single notification flushes as a plain object", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(JSON.stringify({ method: "turn/started", params: { threadId: "t" } }));
  timers.fire();

  assert.equal(JSON.parse(flushed[0]).method, "turn/started");
});

test("consecutive deltas for the same item merge into one delta", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(delta("a", "Hel"));
  coalescer.push(delta("a", "lo"));
  coalescer.push(delta("b", "Other"));
  coalescer.push(delta("a", "!"));
  timers.fire();

  const batch = JSON.parse(flushed[0]);
  assert.deepEqual(
    batch.map((m) => [m.params.itemId, m.params.delta]),
    [
      ["a", "Hello"],
      ["b", "Other"],
      ["a", "!"],
    ],
  );
  assert.equal(batch[0].params.djlEmittedAt, "2026-09-04T10:00:00.000Z");
});

const draft = (memberId, text, restart = false) =>
  JSON.stringify({
    method: "djl/groups/draft",
    params: { groupId: "g", memberId, delta: text, restart },
  });

test("consecutive group drafts for one member merge until the member restarts", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(draft("m1", "Let me ", true));
  coalescer.push(draft("m1", "look."));
  coalescer.push(draft("m1", "The answer ", true));
  coalescer.push(draft("m1", "is 4."));
  coalescer.push(draft("m2", "Hi", true));
  coalescer.push(draft("m1", "!"));
  timers.fire();

  assert.deepEqual(
    JSON.parse(flushed[0]).map((m) => m.params),
    [
      { groupId: "g", memberId: "m1", delta: "Let me look.", restart: true },
      { groupId: "g", memberId: "m1", delta: "The answer is 4.", restart: true },
      { groupId: "g", memberId: "m2", delta: "Hi", restart: true },
      { groupId: "g", memberId: "m1", delta: "!", restart: false },
    ],
  );
});

test("a group draft never merges with another group's draft or an agent delta", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(draft("m1", "a"));
  coalescer.push(
    JSON.stringify({
      method: "djl/groups/draft",
      params: { groupId: "other", memberId: "m1", delta: "b", restart: false },
    }),
  );
  coalescer.push(delta("m1", "c"));
  timers.fire();

  assert.deepEqual(
    JSON.parse(flushed[0]).map((m) => m.params.delta),
    ["a", "b", "c"],
  );
});

test("responses and server requests flush pending notifications first and bypass the window", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(delta("a", "Hel"));
  coalescer.push(JSON.stringify({ id: "r1", result: { ok: true } }));
  coalescer.push(
    JSON.stringify({ id: "q1", method: "item/commandExecution/requestApproval", params: {} }),
  );

  assert.equal(flushed.length, 3);
  assert.equal(JSON.parse(flushed[0]).method, "item/agentMessage/delta");
  assert.equal(JSON.parse(flushed[1]).id, "r1");
  assert.equal(JSON.parse(flushed[2]).id, "q1");
  assert.equal(timers.hasPending(), false);
});

test("unparseable text passes through immediately", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push("not json");

  assert.deepEqual(flushed, ["not json"]);
});

test("a full batch flushes before the window elapses", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({
    ...timers,
    maxBatchMessages: 3,
    flush: (text) => flushed.push(text),
  });

  coalescer.push(JSON.stringify({ method: "a", params: {} }));
  coalescer.push(JSON.stringify({ method: "b", params: {} }));
  assert.equal(flushed.length, 0);
  coalescer.push(JSON.stringify({ method: "c", params: {} }));

  assert.equal(flushed.length, 1);
  assert.equal(JSON.parse(flushed[0]).length, 3);
  assert.equal(timers.hasPending(), false);
});

test("stop flushes what is pending and cancels the timer", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({ ...timers, flush: (text) => flushed.push(text) });

  coalescer.push(delta("a", "x"));
  coalescer.stop();

  assert.equal(flushed.length, 1);
  assert.equal(timers.hasPending(), false);
});

test("a batch flushes early when the next notification would exceed the byte cap", () => {
  const timers = createFakeTimers();
  const flushed = [];
  const coalescer = createOutboundCoalescer({
    ...timers,
    maxBatchBytes: 250,
    flush: (text) => flushed.push(text),
  });

  coalescer.push(chunk("a".repeat(40)));
  coalescer.push(chunk("b".repeat(40)));
  assert.equal(flushed.length, 0);
  coalescer.push(chunk("c".repeat(40)));

  assert.equal(flushed.length, 1);
  assert.equal(JSON.parse(flushed[0]).length, 2);
  timers.fire();
  assert.equal(flushed.length, 2);
  assert.equal(JSON.parse(flushed[1]).params.data, "c".repeat(40));
});

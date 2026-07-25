// FILE: push-notification-service-client.test.js
// Purpose: Verifies timeout behavior for push-service HTTP calls from the local bridge.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/push-notification-service-client

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPushNotificationServiceClient } = require("../src/push-notification-service-client");

test("push service client aborts stalled requests with a timeout error", async () => {
  let attempts = 0;
  const client = createPushNotificationServiceClient({
    baseUrl: "https://push.example.test",
    sessionId: "session-timeout",
    notificationSecret: "secret-timeout",
    requestTimeoutMs: 5,
    retryBaseDelayMs: 0,
    sleepImpl: async () => {},
    fetchImpl: async (_url, options) =>
      new Promise((_, reject) => {
        attempts += 1;
        options.signal.addEventListener(
          "abort",
          () => {
            reject(options.signal.reason);
          },
          { once: true },
        );
      }),
  });

  await assert.rejects(
    client.registerDevice({
      deviceToken: "aabbcc",
      alertsEnabled: true,
      apnsEnvironment: "development",
    }),
    (error) => {
      assert.equal(error.code, "push_request_timeout");
      assert.match(error.message, /timed out after 5ms/);
      return true;
    },
  );
  assert.equal(attempts, 3);
});

test("push registration uses the relay contract and excludes transcript content", async () => {
  let request = null;
  const client = createPushNotificationServiceClient({
    baseUrl: "https://relay.example.test",
    sessionId: "session-register",
    notificationSecret: "secret-register",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true });
        },
      };
    },
  });

  await client.registerDevice({
    deviceToken: "aabbcc",
    alertsEnabled: true,
    apnsEnvironment: "development",
  });

  assert.equal(request.url, "https://relay.example.test/v1/push/session/register-device");
  assert.deepEqual(JSON.parse(request.options.body), {
    sessionId: "session-register",
    notificationSecret: "secret-register",
    deviceToken: "aabbcc",
    alertsEnabled: true,
    environment: "development",
  });
  assert.doesNotMatch(request.options.body, /prompt|response|preview|message/i);
});

test("push service client retries transient server failures with exponential delay", async () => {
  const statuses = [503, 502, 200];
  const delays = [];
  const payloads = [];
  const client = createPushNotificationServiceClient({
    baseUrl: "https://push.example.test",
    sessionId: "session-retry",
    notificationSecret: "secret-retry",
    retryBaseDelayMs: 25,
    sleepImpl: async (delayMs) => {
      delays.push(delayMs);
    },
    fetchImpl: async (_url, options) => {
      payloads.push(options.body);
      const status = statuses.shift();
      return {
        ok: status === 200,
        status,
        async text() {
          return status === 200
            ? JSON.stringify({ ok: true, delivered: true })
            : JSON.stringify({ error: `temporary ${status}` });
        },
      };
    },
  });

  const result = await client.notifyCompletion({
    threadId: "thread-retry",
    turnId: "turn-retry",
    result: "completed",
    title: "Retry me",
    body: "Ready",
    dedupeKey: "dedupe-retry",
  });

  assert.deepEqual(result, { ok: true, delivered: true });
  assert.deepEqual(delays, [25, 50]);
  assert.equal(payloads.length, 3);
  assert.equal(new Set(payloads).size, 1);
  const completionPayload = JSON.parse(payloads[0]);
  assert.equal(completionPayload.title, undefined);
  assert.equal(completionPayload.body, undefined);
  assert.doesNotMatch(payloads[0], /Retry me|Ready/);
});

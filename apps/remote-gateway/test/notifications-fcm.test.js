const test = require("node:test");
const assert = require("node:assert/strict");
const { createNotificationsHandler } = require("../src/notifications-handler");
const { createPushNotificationServiceClient } = require("../src/push-notification-service-client");

test("FCM registration preserves provider and case through the gateway and HTTP contract", async () => {
  let body;
  const client = createPushNotificationServiceClient({
    baseUrl: "https://relay.test.invalid",
    sessionId: "test-session",
    notificationSecret: "test-only",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/capabilities"))
        return { ok: true, text: async () => '{"providers":["fcm"]}' };
      body = JSON.parse(options.body);
      return { ok: true, text: async () => '{"ok":true}' };
    },
  });
  const handler = createNotificationsHandler({ pushServiceClient: client });
  const response = await new Promise((resolve) =>
    handler.handleNotificationsRequest(
      JSON.stringify({
        id: 1,
        method: "notifications/push/register",
        params: {
          provider: "fcm",
          deviceToken: "AbC_Fid",
          alertsEnabled: true,
          appEnvironment: "production",
        },
      }),
      (value) => resolve(JSON.parse(value)),
    ),
  );
  assert.equal(response.result.ok, true);
  assert.deepEqual(body, {
    sessionId: "test-session",
    notificationSecret: "test-only",
    provider: "fcm",
    deviceToken: "AbC_Fid",
    alertsEnabled: true,
    environment: "production",
  });
});

test("invalid FCM identifiers and unknown providers do not reach the relay", async () => {
  let called = 0;
  const handler = createNotificationsHandler({
    pushServiceClient: {
      hasConfiguredBaseUrl: true,
      registerDevice: async () => {
        called++;
      },
    },
  });
  for (const params of [
    { provider: "other", deviceToken: "ABCDEF" },
    { provider: "fcm", deviceToken: " AbC_Fid" },
    { provider: "fcm", deviceToken: "AbC_Fid", appEnvironment: "development" },
  ]) {
    const response = await new Promise((resolve) =>
      handler.handleNotificationsRequest(
        JSON.stringify({ id: 1, method: "notifications/push/register", params }),
        (value) => resolve(JSON.parse(value)),
      ),
    );
    assert.ok(response.error);
  }
  assert.equal(called, 0);
});

test("FCM registration checks relay support before sending an installation", async () => {
  let registrations = 0;
  const handler = createNotificationsHandler({
    pushServiceClient: {
      hasConfiguredBaseUrl: true,
      getCapabilities: async () => ({ providers: ["apns"] }),
      registerDevice: async () => {
        registrations++;
      },
    },
  });
  const response = await new Promise((resolve) =>
    handler.handleNotificationsRequest(
      JSON.stringify({
        id: 2,
        method: "notifications/push/register",
        params: { provider: "fcm", deviceToken: "AbC_Fid", appEnvironment: "production" },
      }),
      (value) => resolve(JSON.parse(value)),
    ),
  );
  assert.equal(response.error?.data?.errorCode, "fcm_not_configured");
  assert.equal(registrations, 0);
});

test("gateway exposes relay capabilities without sending an installation", async () => {
  const handler = createNotificationsHandler({
    pushServiceClient: {
      hasConfiguredBaseUrl: true,
      getCapabilities: async () => ({ providers: ["fcm"] }),
    },
  });
  const response = await new Promise((resolve, reject) => {
    const handled = handler.handleNotificationsRequest(
      JSON.stringify({ id: 3, method: "notifications/push/capabilities" }),
      (value) => resolve(JSON.parse(value)),
    );
    if (!handled) reject(new Error("capabilities method is missing"));
  });
  assert.deepEqual(response.result, { providers: ["fcm"] });
});

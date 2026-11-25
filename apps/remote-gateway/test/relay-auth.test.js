// FILE: relay-auth.test.js
// Purpose: Verifies the local gateway authenticates host connections without leaking secrets into metadata.

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMacConnectionHeaders, requestManagedDesktopUpdate } = require("../src/bridge");
const fixture = require("../../mobile/test/fixtures/remote-v2.json");

test("Mac relay headers include stable host and ephemeral notification secrets", () => {
  const headers = buildMacConnectionHeaders(
    {
      macDeviceId: "mac-device-id",
      macIdentityPublicKey: "mac-public-key",
      relaySessionSecret: "stable-relay-session-secret-that-is-long-enough",
      trustedPhones: {
        "phone-device-id": "phone-public-key",
      },
    },
    {
      pairingCode: "TYPEDCDE23",
      pairingLookupCode: "ABCDEFGH23",
      pairingPayload: {
        v: 2,
        expiresAt: 1_900_000_000_000,
      },
    },
    "ephemeral-notification-secret-that-is-long-enough",
  );

  assert.equal(headers["x-role"], "mac");
  assert.equal(headers["x-djl-session-secret"], "stable-relay-session-secret-that-is-long-enough");
  assert.equal(
    headers["x-djl-notification-secret"],
    "ephemeral-notification-secret-that-is-long-enough",
  );
  assert.equal(headers["x-mac-device-id"], "mac-device-id");
  assert.equal(headers["x-trusted-phone-device-id"], "phone-device-id");
  assert.equal(headers["x-trusted-phone-public-key"], "phone-public-key");
  // The relay gets the derived lookup code, never the code the user types.
  assert.equal(headers["x-pairing-code"], "ABCDEFGH23");
  assert.doesNotMatch(JSON.stringify(headers), /TYPEDCDE23/);
});

test("Mac relay headers sign the registration so the relay can pin the computer identity", () => {
  const { sessionId, macDeviceId, macIdentityPublicKey } = fixture.input;
  const headers = buildMacConnectionHeaders(
    {
      macDeviceId,
      macIdentityPublicKey,
      // The fixture generator derives the Mac identity from this all-ones test seed.
      macIdentityPrivateKey: Buffer.alloc(32, 1).toString("base64"),
      relaySessionSecret: "stable-relay-session-secret-that-is-long-enough",
    },
    { pairingLookupCode: "ABCDEFGH23", pairingPayload: { v: 2, sessionId, expiresAt: 1 } },
    "ephemeral-notification-secret-that-is-long-enough",
  );

  assert.equal(headers["x-mac-device-id"], macDeviceId);
  assert.equal(headers["x-mac-identity-public-key"], macIdentityPublicKey);
  assert.equal(headers["x-mac-registration-signature"], fixture.relayAuth.macRegistrationSignature);
});

test("Mac relay headers reject missing secrets before opening a socket", () => {
  assert.throws(
    () => buildMacConnectionHeaders({ macDeviceId: "mac", macIdentityPublicKey: "key" }, {}, ""),
    /relay authentication secrets are unavailable/i,
  );
});

test("gateway updates are delegated to DJL desktop instead of a package installer", async () => {
  let requests = 0;
  const result = await requestManagedDesktopUpdate(async () => {
    requests += 1;
    return { updateAvailable: true };
  });

  assert.equal(requests, 1);
  assert.deepEqual(result, {
    success: true,
    managedBy: "djl-desktop",
    updateAvailable: true,
  });
  assert.equal(JSON.stringify(result).includes("npm"), false);
});

test("standalone gateway refuses phone-triggered updates without a desktop owner", async () => {
  await assert.rejects(requestManagedDesktopUpdate(null), (error) => {
    assert.equal(error.errorCode, "desktop_update_unavailable");
    assert.match(error.message, /managed by the DJL desktop app/i);
    return true;
  });
});

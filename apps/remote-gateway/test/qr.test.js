// FILE: qr.test.js
// Purpose: Verifies terminal pairing output keeps codes usable without leaking full bearer-like IDs by default.
// Layer: Unit Test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/qr

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SHORT_PAIRING_CODE_ALPHABET,
  SHORT_PAIRING_CODE_LENGTH,
  createShortPairingCode,
  derivePairingCodeKeys,
  printQR,
  shouldPrintPairingJson,
} = require("../src/qr");

test("createShortPairingCode emits a short human-friendly token", () => {
  const code = createShortPairingCode({
    randomBytesImpl() {
      return Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    },
  });

  assert.equal(code.length, SHORT_PAIRING_CODE_LENGTH);
  assert.match(code, new RegExp(`^[${SHORT_PAIRING_CODE_ALPHABET}]+$`));
});

test("derivePairingCodeKeys gives the relay a lookup code that is not the typed code", () => {
  // Same vector as apps/mobile/test/fixtures/remote-v2.json, so every client derives the same keys.
  assert.deepEqual(derivePairingCodeKeys("ABCDEFGHJK"), {
    lookupCode: "7FMLNGRYRD",
    pairingSecret: "TEaZ1ethYE23uB3tOIot0NEaq4mGN7y49uprY48IWoA=",
  });
});

test("printQR prints the short pairing code without the full pairing JSON by default", () => {
  const logs = captureConsoleLog(() => {
    printQR(
      {
        pairingPayload: {
          relay: "ws://127.0.0.1:9000/relay",
          sessionId: "session-sensitive-long-value",
          macDeviceId: "mac-123",
          expiresAt: 1_900_000_000_000,
        },
        pairingCode: "ABCDEFGHJK",
      },
      {
        env: {},
      },
    );
  });

  const output = logs.join("\n");
  assert.match(output, /ABCDEFGHJK/);
  assert.doesNotMatch(output, /RMX1:/);
  assert.match(output, /Session ID: session-/);
  assert.doesNotMatch(output, /session-sensitive-long-value/);
  assert.doesNotMatch(output, /Pairing JSON/);
});

test("printQR refuses to print raw pairing JSON even for debug workflows", () => {
  const logs = captureConsoleLog(() => {
    printQR(
      {
        relay: "ws://127.0.0.1:9000/relay",
        sessionId: "session-debug",
        macDeviceId: "mac-123",
        expiresAt: 1_900_000_000_000,
      },
      {
        printPairingJson: true,
        env: {},
      },
    );
  });

  const output = logs.join("\n");
  assert.match(output, /Pairing JSON debug output is disabled/);
  assert.doesNotMatch(output, /"sessionId":"session-debug"/);
  assert.doesNotMatch(output, /ws:\/\/127\.0\.0\.1:9000\/relay/);
});

test("shouldPrintPairingJson accepts explicit flags and debug env aliases", () => {
  assert.equal(shouldPrintPairingJson({ explicitValue: true, env: {} }), true);
  assert.equal(
    shouldPrintPairingJson({ explicitValue: false, env: { DJL_PRINT_PAIRING_JSON: "1" } }),
    false,
  );
  assert.equal(shouldPrintPairingJson({ env: { DJL_PRINT_PAIRING_JSON: "yes" } }), true);
  assert.equal(shouldPrintPairingJson({ env: { DJL_PRINT_PAIRING_JSON: "on" } }), true);
  assert.equal(shouldPrintPairingJson({ env: { DJL_PRINT_PAIRING_JSON: "0" } }), false);
});

function captureConsoleLog(callback) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    callback();
  } finally {
    console.log = originalLog;
  }

  return logs;
}

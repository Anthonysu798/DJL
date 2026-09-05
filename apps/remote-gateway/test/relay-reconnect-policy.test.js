// FILE: relay-reconnect-policy.test.js
// Purpose: Verifies relay reconnect delays by close code.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/relay-reconnect-policy

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RELAY_CLOSE_RATE_LIMITED,
  relayReconnectDelayMs,
} = require("../src/relay-reconnect-policy");

test("rate-limited closes reconnect immediately", () => {
  assert.equal(RELAY_CLOSE_RATE_LIMITED, 4008);
  assert.equal(relayReconnectDelayMs({ closeCode: 4008, attempt: 1, random: () => 0.9 }), 0);
  assert.equal(relayReconnectDelayMs({ closeCode: 4008, attempt: 5, random: () => 0.9 }), 0);
});

test("other closes back off linearly to five seconds plus bounded jitter", () => {
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 1, random: () => 0 }), 1_000);
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 3, random: () => 0 }), 3_000);
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 9, random: () => 0 }), 5_000);
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 1, random: () => 0.5 }), 1_500);
  // Jitter is capped at 2 s: floor(0.999 * 2000) = 1998.
  assert.equal(relayReconnectDelayMs({ closeCode: 1006, attempt: 9, random: () => 0.999 }), 6_998);
});

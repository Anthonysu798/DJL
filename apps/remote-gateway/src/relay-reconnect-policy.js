// FILE: relay-reconnect-policy.js
// Purpose: Decides how long the bridge waits before reopening the relay socket after a close.
// Layer: CLI helper
// Exports: relayReconnectDelayMs, RELAY_CLOSE_RATE_LIMITED
// Depends on: nothing

const RELAY_CLOSE_RATE_LIMITED = 4008;
const MAX_BASE_DELAY_MS = 5_000;
const MAX_JITTER_MS = 2_000;

// A 4008 means the relay dropped us for sending too fast, not that the
// relay or the phone went away. Waiting only makes the phone stall longer;
// the replay buffer redelivers anything the phone missed.
function relayReconnectDelayMs({ closeCode, attempt, random = Math.random }) {
  if (closeCode === RELAY_CLOSE_RATE_LIMITED) return 0;
  const baseDelayMs = Math.min(1_000 * Math.max(1, attempt), MAX_BASE_DELAY_MS);
  const jitterMs = Math.floor(random() * Math.min(baseDelayMs, MAX_JITTER_MS));
  return baseDelayMs + jitterMs;
}

module.exports = { RELAY_CLOSE_RATE_LIMITED, relayReconnectDelayMs };

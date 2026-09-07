// FILE: presence-heartbeat.js
// Purpose: Sends a periodic encrypted heartbeat so the phone can tell a sleeping laptop from a quiet one.
// Layer: CLI helper
// Exports: createPresenceHeartbeat, PRESENCE_HEARTBEAT_METHOD, DEFAULT_PRESENCE_HEARTBEAT_MS
// Depends on: nothing

const PRESENCE_HEARTBEAT_METHOD = "djl/presence/heartbeat";
const DEFAULT_PRESENCE_HEARTBEAT_MS = 5_000;

function createPresenceHeartbeat({
  intervalMs = DEFAULT_PRESENCE_HEARTBEAT_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = Date.now,
  send,
  isReady = () => true,
} = {}) {
  if (typeof send !== "function") {
    throw new Error("presence heartbeat requires a send callback");
  }
  let timer = null;

  function start() {
    if (timer != null) return;
    timer = setIntervalFn(() => {
      if (!isReady()) return;
      send(JSON.stringify({ method: PRESENCE_HEARTBEAT_METHOD, params: { at: now() } }));
    }, intervalMs);
    timer?.unref?.();
  }

  function stop() {
    if (timer == null) return;
    clearIntervalFn(timer);
    timer = null;
  }

  return { start, stop, isRunning: () => timer != null };
}

module.exports = {
  createPresenceHeartbeat,
  PRESENCE_HEARTBEAT_METHOD,
  DEFAULT_PRESENCE_HEARTBEAT_MS,
};

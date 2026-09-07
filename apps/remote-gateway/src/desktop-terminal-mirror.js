"use strict";

// Mirrors DJL desktop terminals to the phone. The desktop backend owns every
// PTY; the phone only attaches to sessions it asks for, so this module keeps a
// watch list, forwards events for watched terminals, and applies its own
// backpressure toward the phone: past the lag limit output is dropped and the
// terminal is re-attached (fresh history) once the phone catches up.

const TERMINAL = {
  open: "terminal.open",
  write: "terminal.write",
  ackOutput: "terminal.ackOutput",
  resize: "terminal.resize",
  subscribeEvents: "terminal.subscribeEvents",
};

const DEFAULT_TERMINAL_ID = "default";
const EVENT_METHOD = "djl/terminal/event";

function watchKey(threadId, terminalId) {
  return `${threadId}::${terminalId}`;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readInt(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function requireIds(params) {
  const threadId = readString(params?.threadId);
  const terminalId = readString(params?.terminalId) || DEFAULT_TERMINAL_ID;
  if (!threadId) throw new Error("threadId is required.");
  return { threadId, terminalId };
}

// Splits a string so no chunk exceeds maxBytes of UTF-8 and no surrogate pair
// is cut in half. Chunk byte lengths add up to the original byte length.
function splitOutputData(data, maxBytes) {
  if (Buffer.byteLength(data, "utf8") <= maxBytes) return [data];
  const chunks = [];
  let start = 0;
  // Every UTF-16 code unit encodes to at most 3 bytes; a surrogate pair (2
  // units) encodes to 4. Stepping by maxBytes / 3 units keeps every chunk
  // under the byte cap without measuring each candidate.
  const stepUnits = Math.max(1, Math.floor(maxBytes / 3));
  while (start < data.length) {
    let end = Math.min(data.length, start + stepUnits);
    const code = data.charCodeAt(end - 1);
    if (end < data.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

// The desktop keeps up to 1 MiB of history per terminal; a snapshot that large
// would exceed the relay frame limit once JSON-escaped. Keep the tail.
function trimSnapshotHistory(snapshot, maxBytes) {
  if (!snapshot || typeof snapshot.history !== "string") return snapshot;
  const bytes = Buffer.from(snapshot.history, "utf8");
  if (bytes.length <= maxBytes) return snapshot;
  let start = bytes.length - maxBytes;
  // Never start inside a multi-byte sequence.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  let tail = bytes.subarray(start).toString("utf8");
  const newline = tail.indexOf("\n");
  if (newline !== -1 && newline + 1 < tail.length) tail = tail.slice(newline + 1);
  return { ...snapshot, history: tail };
}

function createDesktopTerminalMirror({
  request,
  emit,
  resolveCwd = () => "",
  lagLimitBytes = 1_048_576,
  resyncBytes = 262_144,
  maxOutputChunkBytes = 16_384,
  maxHistoryBytes = 262_144,
}) {
  if (typeof request !== "function") throw new Error("request is required.");
  if (typeof emit !== "function") throw new Error("emit is required.");

  const watched = new Map();
  const known = new Map();

  function remember(threadId, terminalId) {
    if (!threadId || !terminalId) return;
    let ids = known.get(threadId);
    if (!ids) {
      ids = new Set();
      known.set(threadId, ids);
    }
    ids.add(terminalId);
  }

  function emitEvent(event) {
    emit(EVENT_METHOD, event);
  }

  async function attach(entry, cols, rows) {
    const snapshot = await request(TERMINAL.open, {
      threadId: entry.threadId,
      terminalId: entry.terminalId,
      cwd: entry.cwd,
      ...(cols ? { cols } : {}),
      ...(rows ? { rows } : {}),
    });
    entry.unackedBytes = 0;
    entry.lagging = false;
    return trimSnapshotHistory(snapshot, maxHistoryBytes);
  }

  async function resync(entry) {
    if (entry.resyncing) return;
    entry.resyncing = true;
    try {
      const snapshot = await attach(entry);
      if (!watched.has(watchKey(entry.threadId, entry.terminalId))) return;
      emitEvent({
        threadId: entry.threadId,
        terminalId: entry.terminalId,
        type: "started",
        createdAt: new Date().toISOString(),
        snapshot,
      });
    } catch (error) {
      emitEvent({
        threadId: entry.threadId,
        terminalId: entry.terminalId,
        type: "error",
        createdAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      entry.resyncing = false;
    }
  }

  function forwardOutput(entry, event) {
    if (entry.lagging) return;
    const data = typeof event.data === "string" ? event.data : "";
    for (const chunk of splitOutputData(data, maxOutputChunkBytes)) {
      const byteLength = Buffer.byteLength(chunk, "utf8");
      entry.unackedBytes += byteLength;
      emitEvent({ ...event, data: chunk, byteLength });
      if (entry.unackedBytes > lagLimitBytes) {
        entry.lagging = true;
        return;
      }
    }
  }

  return {
    list(params) {
      const threadId = readString(params?.threadId);
      if (!threadId) throw new Error("threadId is required.");
      const ids = new Set([DEFAULT_TERMINAL_ID, ...(known.get(threadId) ?? [])]);
      return { terminals: [...ids] };
    },

    async open(params) {
      const { threadId, terminalId } = requireIds(params);
      const cwd = readString(params?.cwd) || readString(resolveCwd(threadId));
      if (!cwd) throw new Error("A working directory is required to open a desktop terminal.");
      const key = watchKey(threadId, terminalId);
      const entry = watched.get(key) ?? {
        threadId,
        terminalId,
        cwd,
        unackedBytes: 0,
        lagging: false,
        resyncing: false,
      };
      entry.cwd = cwd;
      watched.set(key, entry);
      remember(threadId, terminalId);
      try {
        const snapshot = await attach(entry, readInt(params?.cols), readInt(params?.rows));
        return { snapshot };
      } catch (error) {
        watched.delete(key);
        throw error;
      }
    },

    async write(params) {
      const { threadId, terminalId } = requireIds(params);
      const data = typeof params?.data === "string" ? params.data : "";
      if (!data) return {};
      await request(TERMINAL.write, { threadId, terminalId, data });
      return {};
    },

    async resize(params) {
      const { threadId, terminalId } = requireIds(params);
      const cols = readInt(params?.cols);
      const rows = readInt(params?.rows);
      if (!cols || !rows) throw new Error("cols and rows are required.");
      await request(TERMINAL.resize, { threadId, terminalId, cols, rows });
      return {};
    },

    async ack(params) {
      const { threadId, terminalId } = requireIds(params);
      const bytes = readInt(params?.bytes);
      if (!bytes) return {};
      const entry = watched.get(watchKey(threadId, terminalId));
      if (entry) {
        entry.unackedBytes = Math.max(0, entry.unackedBytes - bytes);
        if (entry.lagging && entry.unackedBytes <= resyncBytes) {
          void resync(entry);
        }
      }
      await request(TERMINAL.ackOutput, { threadId, terminalId, bytes });
      return {};
    },

    close(params) {
      const { threadId, terminalId } = requireIds(params);
      watched.delete(watchKey(threadId, terminalId));
      return {};
    },

    handleEvent(event) {
      if (!event || typeof event !== "object") return;
      const threadId = readString(event.threadId);
      const terminalId = readString(event.terminalId);
      if (!threadId || !terminalId) return;
      remember(threadId, terminalId);
      const entry = watched.get(watchKey(threadId, terminalId));
      if (!entry) return;
      if (event.type === "output") {
        forwardOutput(entry, event);
        return;
      }
      if (event.type === "started" || event.type === "restarted") {
        entry.unackedBytes = 0;
        entry.lagging = false;
      }
      emitEvent(event);
    },

    isWatching(threadId, terminalId) {
      return watched.has(watchKey(threadId, terminalId));
    },

    reset() {
      watched.clear();
    },
  };
}

module.exports = {
  DESKTOP_TERMINAL_EVENT_METHOD: EVENT_METHOD,
  TERMINAL_BACKEND_TAGS: TERMINAL,
  createDesktopTerminalMirror,
  splitOutputData,
  trimSnapshotHistory,
};

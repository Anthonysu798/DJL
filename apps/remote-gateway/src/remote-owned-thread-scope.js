// FILE: remote-owned-thread-scope.js
// Purpose: Keeps an embedded DJL gateway's remote-created threads isolated from the user's global Codex history.
// Layer: CLI helper
// Exports: createRemoteOwnedThreadScope
// Depends on: fs, os, path

const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_OWNED_THREAD_IDS = 5_000;
const DEFAULT_STATE_DIR = path.join(os.homedir(), ".djl");
const DEFAULT_STATE_FILE = "remote-owned-threads.json";

function createRemoteOwnedThreadScope({
  enabled = false,
  statePath = resolveDefaultStatePath(),
  persist = true,
  fsImpl = fs,
} = {}) {
  const ownedThreadIds = enabled ? readOwnedThreadIds(statePath, { fsImpl }) : new Set();

  function remember(threadId) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!enabled || !normalizedThreadId || ownedThreadIds.has(normalizedThreadId)) {
      return false;
    }

    ownedThreadIds.add(normalizedThreadId);
    while (ownedThreadIds.size > MAX_OWNED_THREAD_IDS) {
      ownedThreadIds.delete(ownedThreadIds.values().next().value);
    }
    if (persist) {
      writeOwnedThreadIds(statePath, ownedThreadIds, { fsImpl });
    }
    return true;
  }

  return {
    enabled,
    observeOutbound(message) {
      if (!enabled || !message || typeof message !== "object") {
        return false;
      }

      const method = normalizeNonEmptyString(message.method);
      if (method !== "thread/started" && method !== "thread/start") {
        return false;
      }
      return remember(
        readThreadId(message.params?.thread) ||
          readThreadId(message.result?.thread) ||
          readThreadId(message.payload?.thread),
      );
    },
    filterThreadListResponse(response) {
      if (!enabled || !response || typeof response !== "object") {
        return response;
      }
      return filterResponseContainer(response, ownedThreadIds);
    },
    shouldRejectInbound(message) {
      if (!enabled || !message || typeof message !== "object") {
        return false;
      }
      const method = normalizeNonEmptyString(message.method);
      if (!method || method === "thread/start" || method === "thread/list") {
        return false;
      }
      const threadId = readInboundThreadId(message.params);
      return Boolean(threadId) && !ownedThreadIds.has(threadId);
    },
    createRejectedResponse(message) {
      return {
        id: message?.id ?? null,
        error: {
          code: -32004,
          message: "This task does not belong to the paired DJL installation.",
          data: { errorCode: "thread_not_owned_by_djl" },
        },
      };
    },
    isOwned(threadId) {
      return enabled && ownedThreadIds.has(normalizeNonEmptyString(threadId));
    },
    remember,
  };
}

function filterResponseContainer(response, ownedThreadIds) {
  let changed = false;
  const next = { ...response };
  for (const key of ["result", "payload"]) {
    const value = response[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const filtered = filterThreadCollectionContainer(value, ownedThreadIds);
    if (filtered !== value) {
      next[key] = filtered;
      changed = true;
    }
  }
  return changed ? next : response;
}

function filterThreadCollectionContainer(container, ownedThreadIds) {
  let changed = false;
  const next = { ...container };
  for (const key of ["data", "items", "threads"]) {
    if (!Array.isArray(container[key])) {
      continue;
    }
    next[key] = container[key].filter((thread) => ownedThreadIds.has(readThreadId(thread)));
    changed = true;
  }
  if (
    container.payload &&
    typeof container.payload === "object" &&
    !Array.isArray(container.payload)
  ) {
    const filteredPayload = filterThreadCollectionContainer(container.payload, ownedThreadIds);
    if (filteredPayload !== container.payload) {
      next.payload = filteredPayload;
      changed = true;
    }
  }
  return changed ? next : container;
}

function readInboundThreadId(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return "";
  }
  return (
    normalizeNonEmptyString(params.threadId) ||
    normalizeNonEmptyString(params.thread_id) ||
    normalizeNonEmptyString(params.conversationId) ||
    normalizeNonEmptyString(params.conversation_id) ||
    readThreadId(params.thread) ||
    readThreadId(params.turn)
  );
}

function readThreadId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  return (
    normalizeNonEmptyString(value.id) ||
    normalizeNonEmptyString(value.threadId) ||
    normalizeNonEmptyString(value.thread_id) ||
    normalizeNonEmptyString(value.conversationId) ||
    normalizeNonEmptyString(value.conversation_id)
  );
}

function resolveDefaultStatePath() {
  const stateDir = normalizeNonEmptyString(process.env.DJL_DEVICE_STATE_DIR) || DEFAULT_STATE_DIR;
  return path.join(stateDir, DEFAULT_STATE_FILE);
}

function readOwnedThreadIds(statePath, { fsImpl }) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(statePath, "utf8"));
    const values = Array.isArray(parsed?.threadIds) ? parsed.threadIds : [];
    return new Set(
      values.map(normalizeNonEmptyString).filter(Boolean).slice(-MAX_OWNED_THREAD_IDS),
    );
  } catch {
    return new Set();
  }
}

function writeOwnedThreadIds(statePath, threadIds, { fsImpl }) {
  fsImpl.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  const payload = {
    version: 1,
    threadIds: Array.from(threadIds),
    updatedAt: new Date().toISOString(),
  };
  fsImpl.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fsImpl.renameSync(temporaryPath, statePath);
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  createRemoteOwnedThreadScope,
};

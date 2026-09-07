// FILE: electron-event-projection.js
// Purpose: Projects DJL Electron orchestration thread/shell events into phone app-server notifications.
// Layer: CLI helper
// Exports: createThreadEventProjection
// Depends on: crypto

const { createHash } = require("crypto");

const RUNTIME_MODES = new Set([
  "approval-required",
  "accept-edits",
  "auto-approval",
  "full-access",
]);

// One projection instance tracks every subscribed thread. State is keyed by
// thread id and rebuilt from a detail snapshot on hydrate; events after the
// snapshot sequence mutate it and yield phone notifications.
function createThreadEventProjection() {
  const states = new Map();
  // turnId -> checkpoint turn count, so the adapter can answer a phone's
  // workspace/checkpointDiff for desktop turns from the backend's turn diff.
  const checkpointCountByThreadTurn = new Map();

  function hydrate(thread, snapshotSequence) {
    const threadId = stringValue(thread?.id);
    if (!threadId) return;
    states.set(threadId, {
      lastAppliedSequence: normalizeSequence(snapshotSequence) ?? -1,
      activeTurnId: stringValue(thread.session?.activeTurnId) || null,
      runtimeMode: normalizeRuntimeMode(thread.runtimeMode),
      title: stringValue(thread.title),
      messages: new Map(
        (thread.messages || []).map((message) => [
          message.id,
          {
            text: message.text || "",
            streaming: message.streaming === true,
            turnId: stringValue(message.turnId) || null,
            createdAt: stringValue(message.createdAt),
          },
        ]),
      ),
      activityIds: new Set((thread.activities || []).map((activity) => activity.id)),
    });
    for (const checkpoint of thread.checkpoints || []) {
      rememberCheckpointCount(threadId, checkpoint.turnId, checkpoint.checkpointTurnCount);
    }
  }

  function rememberCheckpointCount(threadId, turnId, count) {
    const normalizedTurnId = stringValue(turnId);
    const normalizedCount = normalizeSequence(count);
    if (!normalizedTurnId || normalizedCount == null) return;
    checkpointCountByThreadTurn.set(`${threadId}|${normalizedTurnId}`, normalizedCount);
  }

  function applyThreadEvent(event) {
    const threadId = stringValue(event?.aggregateId) || stringValue(event?.payload?.threadId);
    const state = states.get(threadId);
    if (!state) return [];
    const sequence = normalizeSequence(event.sequence);
    if (sequence == null || sequence <= state.lastAppliedSequence) return [];
    state.lastAppliedSequence = sequence;

    switch (event.type) {
      case "thread.message-sent":
        return projectMessageSent(threadId, state, event);
      case "thread.session-set":
        return projectSessionSet(threadId, state, event);
      case "thread.activity-appended":
        return projectActivity(threadId, state, event);
      case "thread.meta-updated":
        return projectMeta(threadId, state, event);
      case "thread.turn-diff-completed":
        return projectTurnDiff(threadId, event);
      default:
        return [];
    }
  }

  function projectTurnDiff(threadId, event) {
    const payload = event.payload || {};
    const turnId = stringValue(payload.turnId);
    if (!turnId) return [];
    rememberCheckpointCount(threadId, turnId, payload.checkpointTurnCount);
    const item = checkpointFileChangeItem(payload);
    if (!item) return [];
    return [notification("item/completed", { threadId, turnId, item })];
  }

  function applyShellThread(threadShell) {
    const threadId = stringValue(threadShell?.id);
    const state = states.get(threadId);
    if (!state) return [];
    const runtimeMode = normalizeRuntimeMode(threadShell.runtimeMode);
    if (!runtimeMode || runtimeMode === state.runtimeMode) return [];
    state.runtimeMode = runtimeMode;
    return [
      notification("djl/thread/runtimeMode/updated", {
        threadId,
        runtimeMode,
        ...(stringValue(threadShell.updatedAt) ? { updatedAt: threadShell.updatedAt } : {}),
      }),
    ];
  }

  return {
    hydrate,
    applyThreadEvent,
    applyShellThread,
    has: (threadId) => states.has(threadId),
    forget: (threadId) => {
      states.delete(threadId);
    },
    activeTurnId: (threadId) => states.get(threadId)?.activeTurnId ?? null,
    checkpointTurnCount: (threadId, turnId) =>
      checkpointCountByThreadTurn.get(`${threadId}|${stringValue(turnId)}`) ?? null,
  };
}

function projectMessageSent(threadId, state, event) {
  const payload = event.payload || {};
  const messageId = stringValue(payload.messageId);
  if (!messageId) return [];
  const turnId = stringValue(payload.turnId) || state.activeTurnId;
  const previous = state.messages.get(messageId);

  if (payload.role === "user") {
    if (previous) return [];
    state.messages.set(messageId, {
      text: payload.text || "",
      streaming: false,
      turnId,
      createdAt: stringValue(payload.createdAt),
    });
    return [
      notification("codex/event/user_message", {
        threadId,
        turnId,
        itemId: messageId,
        message: payload.text || "",
      }),
    ];
  }

  if (payload.role !== "assistant") return [];
  const createdAt = previous?.createdAt || stringValue(payload.createdAt);

  if (payload.streaming === true) {
    const delta = payload.text || "";
    state.messages.set(messageId, {
      text: (previous?.text || "") + delta,
      streaming: true,
      turnId,
      createdAt,
    });
    if (!delta) return [];
    return [
      notification("item/agentMessage/delta", {
        threadId,
        turnId,
        itemId: messageId,
        delta,
        djlEmittedAt: stringValue(event.occurredAt),
      }),
    ];
  }

  const text = typeof payload.text === "string" ? payload.text : previous?.text || "";
  state.messages.set(messageId, { text, streaming: false, turnId, createdAt });
  return [
    notification("item/completed", {
      threadId,
      turnId,
      item: {
        id: messageId,
        type: "agentMessage",
        role: "assistant",
        content: [{ type: "outputText", text }],
        createdAt,
      },
    }),
  ];
}

function projectSessionSet(threadId, state, event) {
  const session = event.payload?.session || {};
  const nextTurnId = stringValue(session.activeTurnId) || null;
  const previousTurnId = state.activeTurnId;
  state.activeTurnId = nextTurnId;
  if (nextTurnId && nextTurnId !== previousTurnId) {
    return [
      notification("turn/started", {
        threadId,
        turnId: nextTurnId,
        turn: { id: nextTurnId, status: "inProgress" },
      }),
    ];
  }
  if (!nextTurnId && previousTurnId) {
    const status = session.lastError
      ? "failed"
      : session.status === "interrupted"
        ? "interrupted"
        : "completed";
    return [
      notification("turn/completed", {
        threadId,
        turnId: previousTurnId,
        turn: { id: previousTurnId, status },
      }),
    ];
  }
  return [];
}

function projectActivity(threadId, state, event) {
  const activity = event.payload?.activity;
  const activityId = stringValue(activity?.id);
  if (!activityId || state.activityIds.has(activityId)) return [];
  state.activityIds.add(activityId);
  if (activity.tone === "tool") {
    return projectToolActivity(threadId, state, activity);
  }
  if (activity.kind !== "approval.requested") return [];
  const requestId = stringValue(activity.payload?.requestId);
  if (!requestId) return [];
  const detail = stringValue(activity.payload?.detail) || stringValue(activity.summary);
  return [
    {
      kind: "request",
      id: stableEntityId("djl-electron-approval", `${threadId}|${requestId}`),
      method: approvalMethodFor(activity.payload?.requestKind),
      params: {
        threadId,
        turnId: stringValue(activity.turnId) || state.activeTurnId,
        itemId: activityId,
        command: detail,
        reason: detail,
        djlActionSource: "djl-electron-embedded-bridge",
      },
      approval: { threadId, requestId },
    },
  ];
}

// Tool lifecycle activities carry the provider item type plus the command,
// output, or patch in `payload.data`. They map onto the same item shapes the
// phone already renders for Codex app-server tool items.
function projectToolActivity(threadId, state, activity) {
  const item = toolItemFromActivity(activity);
  if (!item) return [];
  const method = activity.kind === "tool.started" ? "item/started" : "item/completed";
  return [
    notification(method, {
      threadId,
      turnId: stringValue(activity.turnId) || state.activeTurnId,
      item,
    }),
  ];
}

function toolItemFromActivity(activity) {
  const payload = activity.payload || {};
  const itemType = stringValue(payload.itemType);
  if (!itemType) return null;
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const id = stringValue(data.toolCallId) || stringValue(data.callID) || stringValue(activity.id);
  const status = stringValue(payload.status) === "inProgress" ? "inProgress" : "completed";
  const detail = stringValue(payload.detail);

  if (itemType === "command_execution") {
    const item = {
      id,
      type: "commandExecution",
      status,
      command: stringValue(data.command) || (status === "inProgress" ? detail : ""),
      aggregatedOutput: stringValue(data.output) || (status === "completed" ? detail : ""),
    };
    if (Number.isInteger(data.exitCode)) item.exitCode = data.exitCode;
    return item;
  }

  if (itemType === "file_change") {
    const changes =
      Array.isArray(data.changes) && data.changes.length > 0
        ? data.changes
        : fileChangeFromPatch(data);
    return { id, type: "fileChange", status, changes };
  }

  return {
    id,
    type: "toolCall",
    status,
    name: stringValue(payload.title) || itemType,
    output: detail,
  };
}

function fileChangeFromPatch(data) {
  const diff = stringValue(data.unifiedDiff) || stringValue(data.patch) || stringValue(data.diff);
  if (!diff) return [];
  return [
    {
      path: stringValue(data.path) || "workspace",
      kind: stringValue(data.kind) || "update",
      diff,
    },
  ];
}

// One phone file-change card per backend checkpoint: paths and totals only;
// the unified diff is fetched on demand through workspace/checkpointDiff.
function checkpointFileChangeItem(checkpoint) {
  const turnId = stringValue(checkpoint?.turnId);
  const files = Array.isArray(checkpoint?.files) ? checkpoint.files : [];
  if (!turnId || files.length === 0) return null;
  return {
    id: `turn-diff-${turnId}`,
    type: "fileChange",
    status: "completed",
    changes: files.map((file) => ({
      path: stringValue(file.path),
      kind: stringValue(file.kind) || "update",
      additions: Number.isInteger(file.additions) ? file.additions : 0,
      deletions: Number.isInteger(file.deletions) ? file.deletions : 0,
    })),
  };
}

function desktopGitProgressNotification(event) {
  if (!event || typeof event !== "object") return null;
  return notification("djl/git/desktopActionProgress", { ...event });
}

function projectMeta(threadId, state, event) {
  const title = stringValue(event.payload?.title);
  if (!title || title === state.title) return [];
  state.title = title;
  return [
    notification("thread/name/updated", {
      threadId,
      thread_id: threadId,
      name: title,
      title,
    }),
  ];
}

function notification(method, params) {
  return { kind: "notification", method, params };
}

function approvalMethodFor(kind) {
  return kind === "file-change"
    ? "item/fileChange/requestApproval"
    : "item/commandExecution/requestApproval";
}

function stableEntityId(prefix, identity) {
  const digest = createHash("sha256").update(String(identity)).digest("hex").slice(0, 32);
  return `${prefix}-${digest}`;
}

function normalizeRuntimeMode(value) {
  const normalized = stringValue(value);
  return RUNTIME_MODES.has(normalized) ? normalized : null;
}

function normalizeSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  checkpointFileChangeItem,
  createThreadEventProjection,
  desktopGitProgressNotification,
};

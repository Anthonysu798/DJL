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
      default:
        return [];
    }
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

module.exports = { createThreadEventProjection };

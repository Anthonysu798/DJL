// FILE: electron-app-server-adapter.js
// Purpose: Adapts DJL Electron orchestration state to the paired iOS app's app-server RPC contract.
// Layer: CLI helper
// Exports: createElectronAppServerTransport plus pure projection helpers.
// Depends on: crypto, ./electron-backend-rpc

const { createHash, randomUUID } = require("crypto");
const { createElectronBackendRpcClient } = require("./electron-backend-rpc");

const ORCHESTRATION = {
  dispatchCommand: "orchestration.dispatchCommand",
  getSnapshot: "orchestration.getSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
};

const RUNTIME_MODES = new Set([
  "approval-required",
  "accept-edits",
  "auto-approval",
  "full-access",
]);

const MUTATION_METHODS = new Set([
  "thread/start",
  "turn/start",
  "turn/interrupt",
  "djl/thread/runtimeMode/set",
  "thread/archive",
  "thread/unarchive",
  "thread/name/set",
]);

function createElectronAppServerTransport({
  endpoint,
  backend = null,
  now = () => new Date().toISOString(),
  makeId = () => randomUUID(),
  diagnostics = process.env.DJL_ELECTRON_BRIDGE_DIAGNOSTICS === "1",
} = {}) {
  const rpc = backend || createElectronBackendRpcClient({ endpoint });
  const listeners = createListenerBag();
  const activeThreadSubscriptions = new Map();
  const threadStates = new Map();
  const turnReconcileTimers = new Map();
  const pendingApprovalResponses = new Map();
  let stopped = false;
  let shellUnsubscribe = null;

  rpc.onStarted(() => {
    if (stopped) return;
    listeners.emitStarted({
      mode: "djl-electron",
      launchDescription: "DJL Electron embedded backend",
    });
    void refreshSnapshot();
    if (!shellUnsubscribe) {
      shellUnsubscribe = rpc.subscribe(
        ORCHESTRATION.subscribeShell,
        {},
        {
          onChunk: () => void refreshSnapshot(),
        },
      );
    }
  });
  // A backend restart is transient: its client reconnects itself. Do not emit
  // a transport close here because bridge.js treats that as a fatal app-server
  // exit and would tear down the encrypted phone session.
  rpc.onError(() => {});
  rpc.onClose(() => {});

  async function refreshSnapshot() {
    if (stopped) return;
    let snapshot;
    try {
      snapshot = await rpc.request(ORCHESTRATION.getSnapshot, {});
    } catch (error) {
      logDiagnostic(diagnostics, "snapshot-failed", error);
      return;
    }
    const threads = readableThreads(snapshot);
    logDiagnostic(diagnostics, `snapshot threads=${threads.length}`);
    for (const thread of threads) {
      subscribeToThread(thread.id);
      applyThreadSnapshot(thread, {
        announceExisting: false,
        snapshotSequence: snapshot.snapshotSequence,
      });
    }
  }

  function subscribeToThread(threadId) {
    if (!threadId || activeThreadSubscriptions.has(threadId) || stopped) return;
    const unsubscribe = rpc.subscribe(
      ORCHESTRATION.subscribeThread,
      { threadId },
      {
        onChunk(values) {
          for (const value of values) {
            if (value?.kind === "snapshot" && value.snapshot?.thread) {
              applyThreadSnapshot(value.snapshot.thread, {
                announceExisting: true,
                snapshotSequence: value.snapshot.snapshotSequence,
              });
              continue;
            }
            if (value?.kind === "event") {
              void refreshThread(threadId);
            }
          }
        },
        onEnd() {
          activeThreadSubscriptions.delete(threadId);
        },
        onError() {
          activeThreadSubscriptions.delete(threadId);
        },
      },
    );
    activeThreadSubscriptions.set(threadId, unsubscribe);
  }

  async function refreshThread(threadId) {
    if (stopped) return null;
    try {
      const snapshot = await rpc.request(ORCHESTRATION.getSnapshot, {});
      const thread = readableThreads(snapshot).find((entry) => entry.id === threadId);
      if (thread) {
        applyThreadSnapshot(thread, {
          announceExisting: true,
          snapshotSequence: snapshot.snapshotSequence,
        });
      }
      return thread || null;
    } catch {
      // The next live event or client read will recover this projection.
      return null;
    }
  }

  // Subscription callbacks are deliberately lightweight, but an Electron
  // backend restart or a missed callback must not strand a phone-originated
  // turn in its local "sending" state. Reconcile only while the started turn
  // remains active; normal live notifications cancel this fallback promptly.
  function reconcileStartedTurn(threadId, turnId, attempt = 0) {
    if (stopped || !threadId || !turnId) return;
    const priorTimer = turnReconcileTimers.get(threadId);
    if (priorTimer) clearTimeout(priorTimer);

    const timer = setTimeout(async () => {
      const thread = await refreshThread(threadId);
      const activeTurnId =
        threadStates.get(threadId)?.activeTurnId || thread?.session?.activeTurnId || null;
      if (activeTurnId !== turnId || attempt >= 60) {
        turnReconcileTimers.delete(threadId);
        return;
      }
      reconcileStartedTurn(threadId, turnId, attempt + 1);
    }, 250);
    timer.unref?.();
    turnReconcileTimers.set(threadId, timer);
  }

  function stopTurnReconciliation(threadId) {
    const timer = turnReconcileTimers.get(threadId);
    if (timer) clearTimeout(timer);
    turnReconcileTimers.delete(threadId);
  }

  function applyThreadSnapshot(thread, { announceExisting, snapshotSequence = null }) {
    const previous = threadStates.get(thread.id) || emptyThreadState();
    if (isStaleThreadSnapshot(previous, thread, snapshotSequence)) return false;
    const next = snapshotThreadState(thread, snapshotSequence);
    const activeTurnId = thread.session?.activeTurnId || null;
    if (announceExisting && next.runtimeMode && next.runtimeMode !== previous.runtimeMode) {
      emitNotification("djl/thread/runtimeMode/updated", {
        threadId: thread.id,
        runtimeMode: next.runtimeMode,
        ...(stringValue(thread.updatedAt) ? { updatedAt: thread.updatedAt } : {}),
      });
    }
    if (announceExisting && activeTurnId && activeTurnId !== previous.activeTurnId) {
      emitNotification("turn/started", {
        threadId: thread.id,
        turnId: activeTurnId,
        turn: { id: activeTurnId, status: "inProgress" },
      });
    }

    for (const message of thread.messages || []) {
      if (message.role === "user" && !previous.messages.has(message.id) && announceExisting) {
        emitNotification("codex/event/user_message", {
          threadId: thread.id,
          turnId: message.turnId || activeTurnId,
          itemId: message.id,
          message: message.text || "",
        });
        continue;
      }
      if (message.role !== "assistant") continue;
      const old = previous.messages.get(message.id);
      if (message.streaming) {
        const delta = textDelta(old?.text || "", message.text || "");
        if (delta) {
          emitNotification("item/agentMessage/delta", {
            threadId: thread.id,
            turnId: message.turnId || activeTurnId,
            itemId: message.id,
            delta,
          });
        }
      } else if (announceExisting && (!old || old.streaming || old.text !== message.text)) {
        emitNotification("item/completed", {
          threadId: thread.id,
          turnId: message.turnId || activeTurnId,
          item: appServerMessageItem(message),
        });
      }
    }

    for (const activity of thread.activities || []) {
      if (activity.kind !== "approval.requested" || previous.activityIds.has(activity.id)) continue;
      const requestId = stringValue(activity.payload?.requestId);
      if (!requestId) continue;
      const clientRequestId = stableEntityId("djl-electron-approval", `${thread.id}|${requestId}`);
      pendingApprovalResponses.set(clientRequestId, {
        threadId: thread.id,
        requestId,
      });
      emitRaw({
        id: clientRequestId,
        method: approvalMethodFor(activity.payload?.requestKind),
        params: {
          threadId: thread.id,
          turnId: activity.turnId || activeTurnId,
          itemId: activity.id,
          command: stringValue(activity.payload?.detail) || activity.summary,
          reason: stringValue(activity.payload?.detail) || activity.summary,
          djlActionSource: "djl-electron-embedded-bridge",
        },
      });
    }

    if (announceExisting && previous.activeTurnId && !activeTurnId) {
      const latest = thread.latestTurn;
      emitNotification("turn/completed", {
        threadId: thread.id,
        turnId: previous.activeTurnId,
        turn: {
          id: previous.activeTurnId,
          status:
            latest?.state === "interrupted"
              ? "interrupted"
              : latest?.state === "error"
                ? "failed"
                : "completed",
        },
      });
    }
    if (!activeTurnId) stopTurnReconciliation(thread.id);
    threadStates.set(thread.id, next);
    return true;
  }

  async function handleRequest(rawMessage) {
    const message = safeParse(rawMessage);
    if (!message) return;
    if (typeof message.method !== "string") {
      await handleApprovalResponse(message);
      return;
    }
    logDiagnostic(diagnostics, `request method=${message.method}`);
    const requestId = message.id;
    const mutation = createMutationContext(message, makeId);
    try {
      const result = await dispatchAppServerRequest(message.method, message.params || {}, mutation);
      if (requestId != null) {
        logDiagnostic(diagnostics, `response method=${message.method}`);
        emitRaw({
          id: requestId,
          result: mutation
            ? {
                ...result,
                djlMutation: mutation.confirmedReceipt(),
              }
            : result,
        });
      }
    } catch (error) {
      logDiagnostic(diagnostics, `request-failed method=${message.method}`, error);
      if (requestId != null) {
        emitRaw({
          id: requestId,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
            ...(mutation ? { data: { djlMutation: mutation.failedReceipt() } } : {}),
          },
        });
      }
    }
  }

  async function handleApprovalResponse(message) {
    const key = message?.id == null ? "" : String(message.id);
    const pending = pendingApprovalResponses.get(key);
    if (!pending) return;
    const decision = normalizeApprovalDecision(message.result?.decision);
    const mutation = createStableMutationContext(
      `approval-response|${pending.threadId}|${pending.requestId}`,
      makeId,
    );
    try {
      await dispatchCommand(
        {
          type: "thread.approval.respond",
          commandId: mutation.commandId("approval-response"),
          threadId: pending.threadId,
          requestId: pending.requestId,
          decision,
          createdAt: now(),
        },
        mutation,
      );
    } catch (error) {
      // Keep the provider request pending. A duplicated/retried phone response
      // will reuse the same persisted command ID and can safely confirm later.
      emitNotification("djl/serverRequest/failed", {
        requestId: message.id,
        threadId: pending.threadId,
        message: error instanceof Error ? error.message : String(error),
        djlMutation: mutation.failedReceipt(),
      });
      return;
    }
    pendingApprovalResponses.delete(key);
    emitNotification("serverRequest/resolved", {
      requestId: message.id,
      threadId: pending.threadId,
    });
  }

  async function dispatchAppServerRequest(method, params, mutation) {
    switch (method) {
      case "initialize":
        return {
          capabilities: {
            experimentalApi: false,
            djlThreadRuntimeModeSync: true,
          },
          serverInfo: { name: "DJL Electron" },
        };
      case "thread/list":
        return listThreads(await readSnapshot(), params);
      case "thread/read":
      case "thread/resume":
        return readThread(await readSnapshot(), readThreadId(params));
      case "thread/turns/list":
        return listTurns(await readSnapshot(), readThreadId(params), params);
      case "model/list":
        return listModels(await readSnapshot());
      case "thread/start":
        return startThread(params, mutation);
      case "turn/start":
        return startTurn(params, mutation);
      case "turn/interrupt":
        return interruptTurn(params, mutation);
      case "djl/thread/runtimeMode/set":
        return setThreadRuntimeMode(params, mutation);
      case "thread/archive":
      case "thread/unarchive":
        return updateArchiveState(method, params, mutation);
      case "thread/name/set":
        return renameThread(params, mutation);
      case "thread/unsubscribe":
        return {};
      default:
        throw new Error(`DJL Electron does not support remote method: ${method}`);
    }
  }

  async function readSnapshot() {
    const snapshot = await rpc.request(ORCHESTRATION.getSnapshot, {});
    for (const thread of readableThreads(snapshot)) subscribeToThread(thread.id);
    return snapshot;
  }

  async function dispatchCommand(command, mutation = null) {
    // The Electron Effect-RPC contract takes the client command as its payload
    // directly. Wrapping it in `{ command }` makes every mutation fail schema
    // decoding even though read-only snapshot calls continue to work.
    const result = await rpc.request(ORCHESTRATION.dispatchCommand, command);
    mutation?.observeDispatchResult(result);
    return result;
  }

  async function startThread(params, mutation) {
    const snapshot = await readSnapshot();
    const cwd = stringValue(params.cwd) || defaultWorkspaceRoot(snapshot);
    if (!cwd) throw new Error("Choose a workspace before starting a DJL Electron chat.");
    const modelSelection = modelSelectionFor(params, snapshot);
    const runtimeMode = runtimeModeForAppServerParams(params, "approval-required");
    let project = (snapshot.projects || []).find(
      (entry) => entry.workspaceRoot === cwd && !entry.deletedAt,
    );
    if (!project) {
      const projectId = mutation.entityId("djl-project", "project");
      await dispatchCommand(
        {
          type: "project.create",
          commandId: mutation.commandId("project-create"),
          projectId,
          kind: "project",
          title: workspaceTitle(cwd),
          workspaceRoot: cwd,
          defaultModelSelection: modelSelection,
          createdAt: now(),
        },
        mutation,
      );
      const afterProject = await readSnapshot();
      project = (afterProject.projects || []).find((entry) => entry.id === projectId) || {
        id: projectId,
        workspaceRoot: cwd,
      };
    }
    const threadId = mutation.entityId("djl-thread", "thread");
    await dispatchCommand(
      {
        type: "thread.create",
        commandId: mutation.commandId("thread-create"),
        threadId,
        projectId: project.id,
        title: "New chat",
        modelSelection,
        runtimeMode,
        interactionMode: "default",
        envMode: "local",
        branch: null,
        worktreePath: null,
        lastKnownPr: null,
        createdAt: now(),
      },
      mutation,
    );
    const afterThread = await readSnapshot();
    const thread = readableThreads(afterThread).find((entry) => entry.id === threadId);
    if (!thread) throw new Error("DJL Electron did not create the requested chat.");
    applyThreadSnapshot(thread, {
      announceExisting: true,
      snapshotSequence: afterThread.snapshotSequence,
    });
    return { thread: appServerThread(thread, afterThread), runtimeMode };
  }

  async function startTurn(params, mutation) {
    const snapshot = await readSnapshot();
    const threadId = readThreadId(params);
    const thread = readableThreads(snapshot).find((entry) => entry.id === threadId);
    if (!thread) throw new Error("DJL Electron chat was not found.");
    const messageText = extractInputText(params.input);
    if (!messageText) throw new Error("A message is required.");
    const modelSelection = modelSelectionFor(params, snapshot, thread);
    const runtimeMode = runtimeModeForAppServerParams(params, thread.runtimeMode);
    await dispatchCommand(
      {
        type: "thread.turn.start",
        commandId: mutation.commandId("turn-start"),
        threadId,
        message: {
          messageId: mutation.entityId("djl-message", "message"),
          role: "user",
          text: messageText,
          attachments: [],
        },
        modelSelection,
        dispatchMode: "queue",
        runtimeMode,
        interactionMode: "default",
        createdAt: now(),
      },
      mutation,
    );
    const nextSnapshot = await readSnapshot();
    const nextThread = readableThreads(nextSnapshot).find((entry) => entry.id === threadId);
    const turnId = nextThread?.session?.activeTurnId || nextThread?.latestTurn?.turnId || null;
    if (nextThread) {
      applyThreadSnapshot(nextThread, {
        announceExisting: true,
        snapshotSequence: nextSnapshot.snapshotSequence,
      });
    }
    if (turnId) reconcileStartedTurn(threadId, turnId);
    return {
      ...(turnId ? { turn: { id: turnId, status: "inProgress" } } : {}),
      runtimeMode,
    };
  }

  async function setThreadRuntimeMode(params, mutation) {
    const threadId = readThreadId(params);
    const runtimeMode = normalizeRuntimeMode(params.runtimeMode);
    if (!runtimeMode) throw new Error("DJL Electron runtime mode is invalid.");
    const snapshot = await readSnapshot();
    const thread = readableThreads(snapshot).find((entry) => entry.id === threadId);
    if (!thread) throw new Error("DJL Electron chat was not found.");
    const commandResult = await dispatchCommand(
      {
        type: "thread.runtime-mode.set",
        commandId: mutation.commandId("runtime-mode-set"),
        threadId,
        runtimeMode,
        createdAt: now(),
      },
      mutation,
    );
    const authoritativeSnapshot = Array.isArray(commandResult?.threads)
      ? commandResult
      : await readSnapshot();
    const authoritativeThread = readableThreads(authoritativeSnapshot).find(
      (entry) => entry.id === threadId,
    );
    const authoritativeMode = normalizeRuntimeMode(authoritativeThread?.runtimeMode) || runtimeMode;
    if (authoritativeThread) {
      applyThreadSnapshot(authoritativeThread, {
        announceExisting: true,
        snapshotSequence: authoritativeSnapshot.snapshotSequence,
      });
    }
    return { runtimeMode: authoritativeMode };
  }

  async function interruptTurn(params, mutation) {
    const threadId = readThreadId(params);
    await dispatchCommand(
      {
        type: "thread.turn.interrupt",
        commandId: mutation.commandId("turn-interrupt"),
        threadId,
        ...(stringValue(params.turnId) || stringValue(params.turn_id)
          ? { turnId: stringValue(params.turnId) || stringValue(params.turn_id) }
          : {}),
        createdAt: now(),
      },
      mutation,
    );
    return {};
  }

  async function updateArchiveState(method, params, mutation) {
    const threadId = readThreadId(params);
    await dispatchCommand(
      {
        type: method === "thread/archive" ? "thread.archive" : "thread.unarchive",
        commandId: mutation.commandId("archive-state"),
        threadId,
      },
      mutation,
    );
    return {};
  }

  async function renameThread(params, mutation) {
    const threadId = readThreadId(params);
    const title = stringValue(params.name) || stringValue(params.title);
    if (!title) throw new Error("A chat name is required.");
    await dispatchCommand(
      {
        type: "thread.meta.update",
        commandId: mutation.commandId("rename"),
        threadId,
        title,
      },
      mutation,
    );
    return {};
  }

  function emitNotification(method, params) {
    emitRaw({ method, params });
  }
  function emitRaw(message) {
    listeners.emitMessage(JSON.stringify(message));
  }

  return {
    mode: "djl-electron",
    describe() {
      return "DJL Electron embedded backend";
    },
    send(rawMessage) {
      void handleRequest(rawMessage);
    },
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    onStarted(handler) {
      listeners.onStarted = handler;
    },
    shutdown() {
      stopped = true;
      shellUnsubscribe?.();
      for (const unsubscribe of activeThreadSubscriptions.values()) unsubscribe?.();
      activeThreadSubscriptions.clear();
      for (const timer of turnReconcileTimers.values()) clearTimeout(timer);
      turnReconcileTimers.clear();
      rpc.shutdown();
    },
  };
}

function readableThreads(snapshot) {
  if (!Array.isArray(snapshot?.threads)) return [];

  // Electron can briefly expose more than one snapshot entry for the same
  // orchestration thread while a subscription and a shell refresh overlap.
  // A remote client must never receive duplicate IDs: SwiftUI would render
  // duplicate rows that all open the same conversation.
  const byThreadId = new Map();
  for (const thread of snapshot.threads) {
    if (!thread || thread.deletedAt || thread.archivedAt || !stringValue(thread.id)) continue;
    const previous = byThreadId.get(thread.id);
    if (!previous || shouldPreferThreadSnapshot(thread, previous)) {
      byThreadId.set(thread.id, thread);
    }
  }
  return Array.from(byThreadId.values());
}

function shouldPreferThreadSnapshot(candidate, previous) {
  const candidateUpdatedAt = String(candidate.updatedAt || "");
  const previousUpdatedAt = String(previous.updatedAt || "");
  if (candidateUpdatedAt !== previousUpdatedAt) return candidateUpdatedAt > previousUpdatedAt;

  // Timestamps can be equal during a rapid local update. Retain the richer
  // entry so the paired phone receives the current turn history.
  return (candidate.messages || []).length >= (previous.messages || []).length;
}

function listThreads(snapshot, params = {}) {
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(0, Number(params.limit))
    : undefined;
  const data = readableThreads(snapshot)
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, limit)
    .map((thread) => appServerThread(thread, snapshot));
  return { data, nextCursor: null };
}

function readThread(snapshot, threadId) {
  const thread = readableThreads(snapshot).find((entry) => entry.id === threadId);
  if (!thread) throw new Error("DJL Electron chat was not found.");
  return { thread: appServerThreadWithHistory(thread, snapshot) };
}

function listTurns(snapshot, threadId, params = {}) {
  const thread = readableThreads(snapshot).find((entry) => entry.id === threadId);
  if (!thread) throw new Error("DJL Electron chat was not found.");
  const turns = appServerTurns(thread);
  const direction = String(params.sortDirection || "desc").toLowerCase();
  const ordered = direction === "asc" ? turns : turns.slice().reverse();
  const limit = Number.isFinite(Number(params.limit))
    ? Math.max(1, Number(params.limit))
    : ordered.length;
  return { data: ordered.slice(0, limit), nextCursor: null, hasMore: false };
}

function listModels(snapshot) {
  const models = new Map();
  for (const thread of readableThreads(snapshot)) {
    const selection = thread.modelSelection;
    const model = stringValue(selection?.model);
    if (!model) continue;
    models.set(model, selection);
  }
  if (models.size === 0)
    models.set("openai/gpt-5", { provider: "opencode", model: "openai/gpt-5" });
  return {
    items: Array.from(models.entries()).map(([model, selection], index) => ({
      id: model,
      model,
      displayName: model,
      description: `DJL Electron ${stringValue(selection?.provider) || "model"}`,
      isDefault: index === 0,
      supportsFastMode: false,
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    })),
    nextCursor: null,
  };
}

function appServerThread(thread, snapshot) {
  const project = (snapshot?.projects || []).find((entry) => entry.id === thread.projectId);
  const latestMessage = (thread.messages || []).at(-1);
  return {
    id: thread.id,
    title: thread.title,
    name: thread.title,
    preview: stringValue(latestMessage?.text) || undefined,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    cwd: thread.worktreePath || project?.workspaceRoot || undefined,
    model: stringValue(thread.modelSelection?.model) || undefined,
    modelProvider: stringValue(thread.modelSelection?.provider) || undefined,
    reasoningEffort: stringValue(thread.modelSelection?.options?.variant) || undefined,
    runtimeMode: normalizeRuntimeMode(thread.runtimeMode) || undefined,
  };
}

function appServerThreadWithHistory(thread, snapshot) {
  return {
    ...appServerThread(thread, snapshot),
    turns: appServerTurns(thread),
  };
}

function appServerTurns(thread) {
  const byTurn = new Map();
  for (const message of thread.messages || []) {
    const turnId = stringValue(message.turnId) || `djl-history-${message.id}`;
    const entry = byTurn.get(turnId) || {
      id: turnId,
      status: thread.session?.activeTurnId === turnId ? "inProgress" : "completed",
      createdAt: message.createdAt,
      items: [],
    };
    entry.items.push(appServerMessageItem(message));
    byTurn.set(turnId, entry);
  }
  return Array.from(byTurn.values());
}

function appServerMessageItem(message) {
  const role = message.role === "user" ? "user" : "assistant";
  return {
    id: message.id,
    type: role === "user" ? "userMessage" : "agentMessage",
    role,
    content: [{ type: role === "user" ? "inputText" : "outputText", text: message.text || "" }],
    createdAt: message.createdAt,
  };
}

function modelSelectionFor(params, snapshot, thread = null) {
  const requestedModel =
    stringValue(params.model) ||
    stringValue(params.collaborationMode?.settings?.model) ||
    stringValue(thread?.modelSelection?.model) ||
    stringValue(readableThreads(snapshot)[0]?.modelSelection?.model) ||
    "openai/gpt-5";
  const effort =
    stringValue(params.effort) ||
    stringValue(params.collaborationMode?.settings?.reasoning_effort) ||
    stringValue(thread?.modelSelection?.options?.variant);
  return {
    provider: "opencode",
    model: requestedModel,
    ...(effort ? { options: { variant: effort } } : {}),
  };
}

function defaultWorkspaceRoot(snapshot) {
  return (
    stringValue(readableThreads(snapshot)[0]?.worktreePath) ||
    stringValue((snapshot?.projects || [])[0]?.workspaceRoot)
  );
}

function snapshotThreadState(thread, snapshotSequence = null) {
  return {
    snapshotSequence: normalizeSnapshotSequence(snapshotSequence),
    updatedAt: stringValue(thread.updatedAt),
    activeTurnId: thread.session?.activeTurnId || null,
    runtimeMode: normalizeRuntimeMode(thread.runtimeMode),
    messages: new Map(
      (thread.messages || []).map((message) => [
        message.id,
        {
          text: message.text || "",
          streaming: message.streaming === true,
        },
      ]),
    ),
    activityIds: new Set((thread.activities || []).map((activity) => activity.id)),
  };
}

function emptyThreadState() {
  return {
    snapshotSequence: null,
    updatedAt: "",
    activeTurnId: null,
    runtimeMode: null,
    messages: new Map(),
    activityIds: new Set(),
  };
}

function isStaleThreadSnapshot(previous, thread, snapshotSequence) {
  const incomingSequence = normalizeSnapshotSequence(snapshotSequence);
  if (
    incomingSequence != null &&
    previous.snapshotSequence != null &&
    incomingSequence < previous.snapshotSequence
  ) {
    return true;
  }
  if (
    incomingSequence != null &&
    previous.snapshotSequence != null &&
    incomingSequence > previous.snapshotSequence
  ) {
    return false;
  }
  const incomingUpdatedAt = stringValue(thread.updatedAt);
  return Boolean(previous.updatedAt && incomingUpdatedAt && incomingUpdatedAt < previous.updatedAt);
}

function normalizeSnapshotSequence(value) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function createMutationContext(message, makeId) {
  if (!MUTATION_METHODS.has(message.method)) return null;
  const requestIdentity =
    message.id == null
      ? `${message.method}|${makeId()}`
      : `${message.method}|${String(message.id)}`;
  return createStableMutationContext(requestIdentity, makeId);
}

function createStableMutationContext(identity, makeId) {
  const stableIdentity = stringValue(identity) || makeId();
  const id = stableEntityId("djl-remote-mutation", stableIdentity);
  let resultSequence = null;
  return {
    id,
    commandId(stage) {
      return stableEntityId("djl-remote-command", `${stableIdentity}|${stage}`);
    },
    entityId(prefix, stage) {
      return stableEntityId(prefix, `${stableIdentity}|${stage}`);
    },
    observeDispatchResult(result) {
      const sequence = Number(result?.sequence);
      if (Number.isSafeInteger(sequence) && sequence >= 0) {
        resultSequence = Math.max(resultSequence ?? 0, sequence);
      }
    },
    confirmedReceipt() {
      return {
        id,
        status: "confirmed",
        ...(resultSequence == null ? {} : { sequence: resultSequence }),
      };
    },
    failedReceipt() {
      return { id, status: "failed" };
    },
  };
}

function stableEntityId(prefix, identity) {
  const digest = createHash("sha256").update(String(identity)).digest("hex").slice(0, 32);
  return `${prefix}-${digest}`;
}

function runtimeModeForAppServerParams(params, fallback = "approval-required") {
  const sandboxValue = params?.sandboxPolicy?.type ?? params?.sandbox?.type ?? params?.sandbox;
  const sandbox = normalizeToken(sandboxValue);
  const reviewer = normalizeToken(params?.approvalsReviewer ?? params?.approvals_reviewer);
  const approvalPolicy = normalizeToken(params?.approvalPolicy ?? params?.approval_policy);
  const hasExplicitAccess = Boolean(sandbox || reviewer || approvalPolicy);

  if (sandbox === "dangerfullaccess") return "full-access";
  if (approvalPolicy === "never") return "full-access";
  if (reviewer === "autoreview" || reviewer === "guardiansubagent") return "auto-approval";
  if (hasExplicitAccess) return "approval-required";
  return normalizeRuntimeMode(fallback) || "approval-required";
}

function normalizeRuntimeMode(value) {
  const normalized = stringValue(value);
  return RUNTIME_MODES.has(normalized) ? normalized : null;
}

function normalizeToken(value) {
  return stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function textDelta(previous, next) {
  if (!previous) return next;
  return next.startsWith(previous) ? next.slice(previous.length) : next;
}

function extractInputText(input) {
  if (typeof input === "string") return input.trim();
  if (!Array.isArray(input)) return "";
  return input
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      return stringValue(entry.text) || stringValue(entry.content) || "";
    })
    .join("\n")
    .trim();
}

function approvalMethodFor(kind) {
  return kind === "file-change"
    ? "item/fileChange/requestApproval"
    : "item/commandExecution/requestApproval";
}

function normalizeApprovalDecision(value) {
  const decision = stringValue(value);
  return ["accept", "acceptForSession", "decline", "cancel"].includes(decision)
    ? decision
    : "decline";
}

function readThreadId(params) {
  const threadId = stringValue(params?.threadId) || stringValue(params?.thread_id);
  if (!threadId) throw new Error("DJL Electron chat id is required.");
  return threadId;
}

function workspaceTitle(cwd) {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || "DJL project";
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Debug traces deliberately expose only bridge control-plane metadata. They
// never include QR material, endpoint URLs, user prompts, or model output.
function logDiagnostic(enabled, event, error = null) {
  if (!enabled) return;
  const detail =
    error instanceof Error && error.message ? ` reason=${error.message.slice(0, 1_000)}` : "";
  console.warn(`[djl-electron-bridge] ${event}${detail}`);
}

function createListenerBag() {
  return {
    onMessage: null,
    onClose: null,
    onError: null,
    onStarted: null,
    emitMessage(message) {
      this.onMessage?.(message);
    },
    emitStarted(info) {
      this.onStarted?.(info);
    },
  };
}

module.exports = {
  appServerThread,
  appServerThreadWithHistory,
  appServerTurns,
  createElectronAppServerTransport,
  extractInputText,
  listModels,
  listThreads,
};

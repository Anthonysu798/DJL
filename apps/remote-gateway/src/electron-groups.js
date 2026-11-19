// FILE: electron-groups.js
// Purpose: Gives the paired phone DJL Multi agents groups: forwards the desktop's group event stream and maps djl/groups/* requests onto the backend.
// Layer: CLI helper
// Exports: createElectronGroups
// Depends on: nothing

const GROUPS = {
  list: "groups.list",
  create: "groups.create",
  update: "groups.update",
  stopMember: "groups.stopMember",
  resolvePause: "groups.resolvePause",
  subscribe: "groups.subscribe",
};
const HARNESSES_LIST_ACCOUNTS = "harnesses.listAccounts";
// The desktop's member kinds and their names (GROUP_MEMBER_PROVIDERS and
// PROVIDER_DISPLAY_NAMES in packages/contracts), in the desktop's order.
const GROUP_MEMBER_AGENTS = [
  ["codex", "Codex"],
  ["claudeAgent", "Claude"],
  ["cursor", "Cursor"],
  ["grok", "Grok"],
  ["kimi", "Kimi Code"],
  ["iflow", "iFlow"],
  ["qwen", "Qwen Code"],
  ["codebuddy", "CodeBuddy Code"],
  ["pi", "Pi"],
  ["gemini", "Gemini"],
];

// `request` and `subscribe` talk to the backend, `emit` sends a phone
// notification, and `dispatchCommand` / `findThread` are the adapter's own
// orchestration helpers, so a group message is dispatched like any other turn.
function createElectronGroups({ request, subscribe, emit, dispatchCommand, findThread, now }) {
  let unsubscribe = null;

  function start() {
    if (unsubscribe) return;
    unsubscribe = subscribe(
      GROUPS.subscribe,
      {},
      {
        onChunk(values) {
          for (const value of values) forward(value);
        },
        onEnd() {
          unsubscribe = null;
        },
        onError() {
          // Resubscribing delivers a fresh snapshot first, so the phone resyncs.
          unsubscribe = null;
          start();
        },
      },
    );
  }

  function stop() {
    unsubscribe?.();
    unsubscribe = null;
  }

  // Drafts get their own method so the outbound coalescer can merge a burst.
  function forward(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "reply.draft") {
      emit("djl/groups/draft", {
        groupId: event.groupId,
        memberId: event.memberId,
        delta: event.delta,
        restart: event.restart,
      });
      return;
    }
    emit("djl/groups/event", event);
  }

  async function groupThreadId(groupId) {
    const { groups } = await request(GROUPS.list, {});
    const group = groups.find((entry) => entry.id === groupId);
    if (!group) throw new Error("Group not found");
    return group.threadId;
  }

  // Ready means the same as in the desktop's group setup dialog: the agent's
  // account status is "ready". Ready agents come first, as they do there.
  async function listAgents() {
    const { accounts } = await request(HARNESSES_LIST_ACCOUNTS, {});
    const agents = GROUP_MEMBER_AGENTS.map(([provider, displayName]) => ({
      provider,
      displayName,
      ready: accounts.some((account) => account.id === provider && account.status === "ready"),
    }));
    return { agents: [...agents.filter((a) => a.ready), ...agents.filter((a) => !a.ready)] };
  }

  // The same command the desktop's group composer sends: a message sent while
  // a round is running joins it instead of waiting for it to end.
  async function send(params, mutation) {
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!text) throw new Error("A message is required.");
    const threadId = await groupThreadId(params.groupId);
    const thread = await findThread(threadId);
    await dispatchCommand(
      {
        type: "thread.turn.start",
        commandId: mutation.commandId("group-send"),
        threadId,
        message: {
          messageId: mutation.entityId("djl-message", "message"),
          role: "user",
          text,
          attachments: [],
        },
        modelSelection: { provider: "group", model: "group" },
        dispatchMode: thread?.session?.status === "running" ? "steer" : "queue",
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: now(),
      },
      mutation,
    );
    return {};
  }

  async function stopAll(params, mutation) {
    await dispatchCommand(
      {
        type: "thread.turn.interrupt",
        commandId: mutation.commandId("group-stop"),
        threadId: await groupThreadId(params.groupId),
        createdAt: now(),
      },
      mutation,
    );
    return {};
  }

  // Returns undefined for a method that is not a group method.
  function handleRequest(method, params, mutation) {
    switch (method) {
      case "djl/groups/list":
        return request(GROUPS.list, {});
      case "djl/groups/agents":
        return listAgents();
      case "djl/groups/create":
        return request(GROUPS.create, { name: params.name, members: params.members });
      case "djl/groups/send":
        return send(params, mutation);
      case "djl/groups/stop":
        return stopAll(params, mutation);
      case "djl/groups/stopMember":
        return request(GROUPS.stopMember, {
          groupId: params.groupId,
          memberId: params.memberId,
        }).then(() => ({}));
      case "djl/groups/resolvePause":
        return request(GROUPS.resolvePause, {
          groupId: params.groupId,
          action: params.action,
          continueText: params.continueText,
        }).then(() => ({}));
      case "djl/groups/setSkipAllWarning":
        return request(GROUPS.update, {
          groupId: params.groupId,
          skipAllWarning: params.skipAllWarning,
        });
      default:
        return undefined;
    }
  }

  return { start, stop, handleRequest };
}

module.exports = { createElectronGroups };

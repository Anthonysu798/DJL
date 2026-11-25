// FILE: guest-scope.js
// Purpose: The rules for a gateway that serves ONE invited guest of ONE Multi agents group:
//          which requests it answers, what it tells the guest about the group, and which
//          messages may leave. Everything not named here is refused. Pure functions, so the
//          rules can be tested without a relay or a backend.
// Layer: CLI helper
// Exports: parseGuestScope, classifyGuestInbound, guestAdapterRequest, filterGuestGroupsList,
//          filterGuestGroupEvent, allowGuestOutbound, guestMessageId, GUEST_DENIED_MESSAGE.
//          Roles: "viewer" reads the chat, "chat" also writes, "agent" lends an agent.
// Depends on: nothing

// Must match GROUP_GUEST_MESSAGE_PREFIX and GroupGuestId in packages/contracts/src/groups.ts:
// the server reads the guest's id out of the message id to decide what the message may do.
const GUEST_MESSAGE_PREFIX = "group-guest-";
const GUEST_ID_PATTERN = /^[a-z0-9]{8,32}$/;
const GUEST_ROLES = new Set(["viewer", "chat", "agent"]);
const GUEST_DENIED_MESSAGE = "This is not available to guests.";
const GUEST_DENIED_CODE = -32601;

// The bridge itself answers these (connection setup and host status); nothing else is local.
const BRIDGE_METHODS = new Set([
  "initialize",
  "initialized",
  "account/status/read",
  "getAuthStatus",
]);
// The live messages of a group chat, as thread events of the group's thread.
const THREAD_EVENT_METHODS = new Set([
  "codex/event/user_message",
  "item/agentMessage/delta",
  "item/completed",
]);
const GROUP_EVENT_METHODS = new Set(["djl/groups/event", "djl/groups/draft"]);
// A guest invited as an agent lends one of their own agents: their computer announces it,
// receives the turns it is asked to answer, and sends the answers back. It gets nothing else,
// not even the chat: what its agent needs to read arrives inside each turn.
const AGENT_REQUEST_METHODS = new Set([
  "djl/groups/agent/join",
  "djl/groups/agent/reply",
  "djl/groups/agent/draft",
]);
const AGENT_EVENT_METHODS = new Set([
  "djl/groups/agent/turn",
  "djl/groups/agent/cancel",
  "djl/groups/agent/removed",
]);
const PRESENCE_METHOD = "djl/presence/heartbeat";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Reads the scope a guest gateway was started with; throws on anything incomplete. */
function parseGuestScope(raw) {
  if (raw == null || raw === "") return null;
  let source = raw;
  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      throw new Error("The guest scope is not valid JSON.");
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw new Error("The guest scope must be an object.");
  const scope = {
    guestId: text(source.guestId),
    groupId: text(source.groupId),
    threadId: text(source.threadId),
    role: text(source.role),
    name: text(source.name),
  };
  if (!GUEST_ID_PATTERN.test(scope.guestId))
    throw new Error("The guest scope has no valid guest id.");
  if (!scope.groupId || !scope.threadId) throw new Error("The guest scope names no group.");
  if (!GUEST_ROLES.has(scope.role)) throw new Error("The guest scope has no valid role.");
  return Object.freeze(scope);
}

/**
 * Where one message from the guest's device goes: "drop" (never answered), "bridge" (the
 * bridge's own connection handlers) or "adapter" (which then applies `guestAdapterRequest`).
 * A message without a method is a JSON-RPC reply; from a guest it could only be an attempt to
 * answer one of the owner's approval prompts, so it is dropped.
 */
function classifyGuestInbound(message) {
  if (!message || typeof message !== "object" || typeof message.method !== "string") return "drop";
  return BRIDGE_METHODS.has(message.method) ? "bridge" : "adapter";
}

/**
 * What the adapter does with a guest's request: answer with a fixed result, pass it to the
 * groups bridge or to the thread reader, or refuse. The phone app needs the empty chat and model
 * lists to finish connecting.
 */
function guestAdapterRequest(scope, method, params) {
  const input = params && typeof params === "object" ? params : {};
  if (scope.role === "agent")
    return method === "initialize" || AGENT_REQUEST_METHODS.has(method)
      ? { kind: "pass" }
      : { kind: "deny" };
  switch (method) {
    case "initialize":
      return { kind: "pass" };
    case "thread/list":
      return { kind: "static", result: { data: [], nextCursor: null } };
    case "model/list":
      return { kind: "static", result: { data: [] } };
    case "djl/groups/list":
      return { kind: "pass" };
    case "thread/read":
      return text(input.threadId) === scope.threadId ? { kind: "pass" } : { kind: "deny" };
    case "djl/groups/send":
      return scope.role === "chat" && text(input.groupId) === scope.groupId
        ? { kind: "pass" }
        : { kind: "deny" };
    default:
      return { kind: "deny" };
  }
}

/** A message id that carries the guest's id, unique per request the guest made. */
function guestMessageId(scope, unique) {
  return `${GUEST_MESSAGE_PREFIX}${scope.guestId}-${String(unique).replace(/[^A-Za-z0-9]/g, "")}`;
}

// The owner's folder path, private instructions and other guests are not the guest's business.
function redactGroup(scope, group) {
  return {
    ...group,
    folder: "(hidden)",
    brief: "",
    guests: (group.guests || []).filter((guest) => guest && guest.id === scope.guestId),
  };
}

// What the agents did on the owner's computer (files changed, commands run, the file being
// read now) stays there, as it does in the chat history (see redactGuestThread).
function redactReply(reply) {
  return reply && typeof reply === "object" ? { ...reply, files: [], commands: [] } : reply;
}

function redactActivity(activity) {
  return activity && typeof activity === "object" ? { ...activity, detail: null } : activity;
}

function redactMission(mission) {
  if (!mission || typeof mission !== "object") return mission;
  const stats = mission.stats && typeof mission.stats === "object" ? mission.stats : null;
  return stats ? { ...mission, stats: { ...stats, files: [] } } : mission;
}

function redactActivities(activities) {
  if (!activities || typeof activities !== "object") return activities;
  return Object.fromEntries(
    Object.entries(activities).map(([memberId, activity]) => [memberId, redactActivity(activity)]),
  );
}

function pick(record, keys) {
  if (!record || typeof record !== "object") return record;
  return Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
}

/** The answer to "list groups", cut down to the guest's one group. */
function filterGuestGroupsList(scope, result) {
  const source = result && typeof result === "object" ? result : {};
  const group = (source.groups || []).find((entry) => entry && entry.id === scope.groupId);
  const memberIds = new Set((group?.members || []).map((member) => member.id));
  const ofGroup = (entries) =>
    Array.isArray(entries)
      ? entries.filter((entry) => entry && entry.groupId === scope.groupId)
      : [];
  return {
    groups: group ? [redactGroup(scope, group)] : [],
    replies: ofGroup(source.replies).map(redactReply),
    ...(source.live && typeof source.live === "object"
      ? {
          live: {
            memberStates: pick(source.live.memberStates, memberIds) || {},
            drafts: pick(source.live.drafts, memberIds) || {},
            ...(source.live.rounds
              ? { rounds: pick(source.live.rounds, new Set([scope.groupId])) }
              : {}),
            ...(source.live.activities
              ? { activities: redactActivities(pick(source.live.activities, memberIds)) }
              : {}),
          },
        }
      : {}),
    ...(source.reactions ? { reactions: ofGroup(source.reactions) } : {}),
    ...(source.missions ? { missions: ofGroup(source.missions).map(redactMission) } : {}),
  };
}

/** One group event as the guest may see it, or null when it is about another group. */
function filterGuestGroupEvent(scope, event) {
  if (!event || typeof event !== "object") return null;
  switch (event.type) {
    case "snapshot":
      return { type: "snapshot", ...filterGuestGroupsList(scope, event) };
    case "group.upserted":
      return event.group?.id === scope.groupId
        ? { ...event, group: redactGroup(scope, event.group) }
        : null;
    case "group.deleted":
      return event.groupId === scope.groupId
        ? { type: "group.deleted", groupId: event.groupId, folder: "(hidden)" }
        : null;
    case "reply.recorded":
      return event.reply?.groupId === scope.groupId
        ? { ...event, reply: redactReply(event.reply) }
        : null;
    case "reaction.set":
      return event.reaction?.groupId === scope.groupId ? event : null;
    case "mission.upserted":
      return event.mission?.groupId === scope.groupId
        ? { ...event, mission: redactMission(event.mission) }
        : null;
    case "member.activity":
      return event.groupId === scope.groupId
        ? { ...event, activity: redactActivity(event.activity) }
        : null;
    case "member.state":
    case "reply.draft":
    case "reaction.removed":
    case "round.progress":
      return event.groupId === scope.groupId ? event : null;
    default:
      // An event kind this file does not know cannot be shown to be about the guest's group.
      return null;
  }
}

/**
 * Whether a message may leave for the guest's device. Replies to the guest's own requests may;
 * of everything the backend streams, only the guest's group and its chat thread may. Anything
 * that asks the device a question (an approval prompt) never may.
 */
function allowGuestOutbound(scope, message) {
  if (!message || typeof message !== "object") return false;
  if (typeof message.method !== "string") return message.id !== undefined && message.id !== null;
  if (message.id !== undefined && message.id !== null) return false;
  if (message.method === PRESENCE_METHOD) return true;
  if (scope.role === "agent") return AGENT_EVENT_METHODS.has(message.method);
  if (GROUP_EVENT_METHODS.has(message.method)) return true;
  if (!THREAD_EVENT_METHODS.has(message.method)) return false;
  const params = message.params && typeof message.params === "object" ? message.params : {};
  if (text(params.threadId) !== scope.threadId) return false;
  // A finished item can also be a tool call (a command run, a file changed). A guest gets the
  // chat's messages only, live as well as when reading the history (see redactGuestThread).
  if (message.method === "item/completed") return isMessageItem(params.item);
  return true;
}

function isMessageItem(item) {
  return Boolean(item) && (item.type === "userMessage" || item.type === "agentMessage");
}

/**
 * The group's chat as a guest may read it: the messages only. The owner's folder path and the
 * agents' tool activity (commands run, files opened) stay on the owner's computer.
 */
function redactGuestThread(result) {
  const thread = result && typeof result === "object" ? result.thread : null;
  if (!thread || typeof thread !== "object") return { thread: null };
  const { cwd: _cwd, ...rest } = thread;
  return {
    thread: {
      ...rest,
      turns: (Array.isArray(thread.turns) ? thread.turns : []).map((turn) => ({
        ...turn,
        items: (Array.isArray(turn?.items) ? turn.items : []).filter(isMessageItem),
      })),
    },
  };
}

module.exports = {
  redactGuestThread,
  GUEST_DENIED_CODE,
  GUEST_DENIED_MESSAGE,
  GUEST_MESSAGE_PREFIX,
  allowGuestOutbound,
  classifyGuestInbound,
  filterGuestGroupEvent,
  filterGuestGroupsList,
  guestAdapterRequest,
  guestMessageId,
  parseGuestScope,
};

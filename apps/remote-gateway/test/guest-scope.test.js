// FILE: guest-scope.test.js
// Purpose: Pins down what an invited guest's gateway answers, shows and lets out.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/guest-scope

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allowGuestOutbound,
  classifyGuestInbound,
  filterGuestGroupEvent,
  filterGuestGroupsList,
  guestAdapterRequest,
  guestMessageId,
  parseGuestScope,
} = require("../src/guest-scope");

const scope = parseGuestScope({
  guestId: "a1b2c3d4e5f60718",
  groupId: "group-1",
  threadId: "thread-1",
  role: "chat",
  name: "Alex",
});
const viewer = parseGuestScope({ ...scope, role: "viewer" });

const group = (id, extra = {}) => ({
  id,
  threadId: id === "group-1" ? "thread-1" : "thread-2",
  name: id,
  folder: `/srv/owner/${id}`,
  brief: "private instructions",
  members: [{ id: `${id}-m1`, groupId: id }],
  guests: [
    { id: "a1b2c3d4e5f60718", name: "Alex", role: "chat" },
    { id: "ffffffffffffffff", name: "Sam", role: "viewer" },
  ],
  ...extra,
});

test("a scope must be complete, and no scope means an ordinary gateway", () => {
  assert.equal(parseGuestScope(""), null);
  assert.equal(parseGuestScope(undefined), null);
  assert.equal(parseGuestScope(JSON.stringify(scope)).guestId, "a1b2c3d4e5f60718");
  assert.throws(() => parseGuestScope("{not json"), /not valid JSON/);
  assert.throws(() => parseGuestScope({ ...scope, guestId: "has-dash" }), /guest id/);
  assert.throws(() => parseGuestScope({ ...scope, threadId: "" }), /names no group/);
  assert.throws(() => parseGuestScope({ ...scope, role: "owner" }), /valid role/);
});

test("replies from the guest's device are dropped, so it cannot answer the owner's prompts", () => {
  assert.equal(classifyGuestInbound({ id: 7, result: { decision: "approved" } }), "drop");
  assert.equal(classifyGuestInbound(null), "drop");
  assert.equal(classifyGuestInbound({ method: "initialize", id: 1 }), "bridge");
  assert.equal(classifyGuestInbound({ method: "account/status/read", id: 2 }), "bridge");
  assert.equal(classifyGuestInbound({ method: "workspace/readFile", id: 3 }), "adapter");
  assert.equal(classifyGuestInbound({ method: "desktop/preferences/update", id: 4 }), "adapter");
});

test("only the guest's own group and thread can be read or written", () => {
  const deny = { kind: "deny" };
  const pass = { kind: "pass" };
  assert.deepEqual(guestAdapterRequest(scope, "djl/groups/list", {}), pass);
  assert.deepEqual(guestAdapterRequest(scope, "thread/read", { threadId: "thread-1" }), pass);
  assert.deepEqual(guestAdapterRequest(scope, "thread/read", { threadId: "thread-2" }), deny);
  assert.deepEqual(guestAdapterRequest(scope, "djl/groups/send", { groupId: "group-1" }), pass);
  assert.deepEqual(guestAdapterRequest(scope, "djl/groups/send", { groupId: "group-2" }), deny);
  assert.deepEqual(guestAdapterRequest(viewer, "djl/groups/send", { groupId: "group-1" }), deny);
  assert.deepEqual(guestAdapterRequest(scope, "thread/list", {}).result, {
    data: [],
    nextCursor: null,
  });
  assert.deepEqual(guestAdapterRequest(scope, "model/list", {}).result, { data: [] });
  for (const method of [
    "turn/start",
    "thread/start",
    "turn/interrupt",
    "workspace/readFile",
    "project/list",
    "git/status",
    "desktop/continueOnDesktop",
    "djl/terminal/write",
    "djl/groups/create",
    "djl/groups/stop",
    "djl/groups/stopMember",
    "djl/groups/resolvePause",
    "djl/groups/setSkipAllWarning",
    "djl/groups/attachment",
    "djl/groups/upload",
    "djl/groups/agents",
    "fuzzyFileSearch",
    "notifications/push/register",
    "something/new",
  ])
    assert.deepEqual(guestAdapterRequest(scope, method, { groupId: "group-1" }), deny, method);
});

test("a guest's message id names the guest and cannot be bent by the device", () => {
  assert.equal(
    guestMessageId(scope, "flutter-abc-12"),
    "group-guest-a1b2c3d4e5f60718-flutterabc12",
  );
  // A device-chosen id cannot smuggle in another guest's id: the guest id is fixed by the scope.
  assert.match(
    guestMessageId(scope, "x-group-guest-ffffffffffffffff-1"),
    /^group-guest-a1b2c3d4e5f60718-/,
  );
});

test("the group list shows one group, without the owner's folder, brief or other guests", () => {
  const listed = filterGuestGroupsList(scope, {
    groups: [group("group-1"), group("group-2")],
    replies: [
      { id: "r1", groupId: "group-1" },
      { id: "r2", groupId: "group-2" },
    ],
    live: {
      memberStates: { "group-1-m1": "working", "group-2-m1": "working" },
      drafts: { "group-2-m1": "secret draft" },
      rounds: { "group-1": { hops: 1 }, "group-2": { hops: 2 } },
      activities: { "group-2-m1": { kind: "reading", detail: "/srv/owner/secret.txt" } },
    },
    reactions: [{ groupId: "group-2", targetId: "x" }],
    missions: [{ groupId: "group-1", id: "m" }],
  });
  assert.deepEqual(
    listed.groups.map((entry) => entry.id),
    ["group-1"],
  );
  assert.equal(listed.groups[0].folder, "(hidden)");
  assert.equal(listed.groups[0].brief, "");
  assert.deepEqual(
    listed.groups[0].guests.map((guest) => guest.name),
    ["Alex"],
  );
  assert.deepEqual(listed.replies, [{ id: "r1", groupId: "group-1", files: [], commands: [] }]);
  assert.deepEqual(listed.live.memberStates, { "group-1-m1": "working" });
  assert.deepEqual(listed.live.drafts, {});
  assert.deepEqual(listed.live.rounds, { "group-1": { hops: 1 } });
  assert.deepEqual(listed.live.activities, {});
  assert.deepEqual(listed.reactions, []);
  assert.deepEqual(listed.missions, [{ groupId: "group-1", id: "m" }]);
  assert.doesNotMatch(JSON.stringify(listed), /owner|secret|private instructions|Sam/);
});

test("a guest removed from the group sees an empty list", () => {
  assert.deepEqual(filterGuestGroupsList(scope, { groups: [group("group-2")], replies: [] }), {
    groups: [],
    replies: [],
  });
});

test("events about other groups, and kinds this file does not know, are withheld", () => {
  const keep = (event) => assert.notEqual(filterGuestGroupEvent(scope, event), null, event.type);
  const drop = (event) => assert.equal(filterGuestGroupEvent(scope, event), null, event.type);
  keep({ type: "member.state", groupId: "group-1", memberId: "group-1-m1", state: "working" });
  drop({ type: "member.state", groupId: "group-2", memberId: "group-2-m1", state: "working" });
  keep({ type: "reply.recorded", reply: { groupId: "group-1" } });
  drop({ type: "reply.recorded", reply: { groupId: "group-2" } });
  drop({ type: "reply.draft", groupId: "group-2", memberId: "x", delta: "secret" });
  drop({ type: "mission.upserted", mission: { groupId: "group-2" } });
  drop({ type: "reaction.set", reaction: { groupId: "group-2" } });
  drop({ type: "group.upserted", group: group("group-2") });
  drop({ type: "something.new", groupId: "group-1" });
  const upserted = filterGuestGroupEvent(scope, {
    type: "group.upserted",
    group: group("group-1"),
  });
  assert.equal(upserted.group.folder, "(hidden)");
  const deleted = filterGuestGroupEvent(scope, {
    type: "group.deleted",
    groupId: "group-1",
    folder: "/srv/owner/group-1",
  });
  assert.equal(deleted.folder, "(hidden)");
  const snapshot = filterGuestGroupEvent(scope, {
    type: "snapshot",
    groups: [group("group-1"), group("group-2")],
    replies: [],
  });
  assert.deepEqual(
    snapshot.groups.map((entry) => entry.id),
    ["group-1"],
  );
});

test("only the guest's chat leaves; other chats and every prompt stay inside", () => {
  const out = (message) => allowGuestOutbound(scope, message);
  assert.equal(out({ id: 3, result: {} }), true);
  assert.equal(out({ id: 3, error: { code: -32601 } }), true);
  assert.equal(out({ method: "djl/groups/event", params: { type: "member.state" } }), true);
  assert.equal(out({ method: "djl/groups/draft", params: {} }), true);
  assert.equal(out({ method: "djl/presence/heartbeat", params: { at: 1 } }), true);
  assert.equal(
    out({ method: "item/agentMessage/delta", params: { threadId: "thread-1", delta: "hi" } }),
    true,
  );
  assert.equal(
    out({ method: "item/agentMessage/delta", params: { threadId: "thread-2", delta: "secret" } }),
    false,
  );
  assert.equal(out({ method: "item/completed", params: { threadId: "thread-2" } }), false);
  // A finished message leaves; a finished tool call in the same chat does not.
  const completed = (item) =>
    out({ method: "item/completed", params: { threadId: "thread-1", item } });
  assert.equal(
    completed({ type: "agentMessage", content: [{ type: "outputText", text: "done" }] }),
    true,
  );
  assert.equal(completed({ type: "userMessage", content: [] }), true);
  assert.equal(
    completed({ type: "commandExecution", command: "cat /srv/owner/.ssh/id_rsa" }),
    false,
  );
  assert.equal(completed({ type: "fileChange", changes: [{ path: "/srv/owner/app.ts" }] }), false);
  assert.equal(completed({ type: "reasoning", summary: ["thinking"] }), false);
  assert.equal(completed(undefined), false);
  assert.equal(out({ method: "codex/event/user_message", params: {} }), false);
  // Thread events the group chat does not need stay inside even for the guest's own thread.
  assert.equal(out({ method: "turn/started", params: { threadId: "thread-1" } }), false);
  assert.equal(out({ method: "thread/started", params: { thread: { cwd: "/srv/owner" } } }), false);
  assert.equal(out({ method: "djl/terminal/output", params: { data: "ls" } }), false);
  // An approval prompt is a request to the device: it has both a method and an id.
  assert.equal(
    out({
      id: 9,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1" },
    }),
    false,
  );
  assert.equal(out(null), false);
  assert.equal(out({}), false);
});

const lender = parseGuestScope({ ...scope, role: "agent" });

test("a guest who lends an agent may announce it and answer, and nothing else", () => {
  for (const method of [
    "initialize",
    "djl/groups/agent/join",
    "djl/groups/agent/reply",
    "djl/groups/agent/draft",
  ])
    assert.deepEqual(guestAdapterRequest(lender, method, {}), { kind: "pass" }, method);
  // Not even the chat: what its agent needs to read arrives inside each turn.
  for (const [method, params] of [
    ["djl/groups/list", {}],
    ["thread/read", { threadId: "thread-1" }],
    ["thread/list", {}],
    ["model/list", {}],
    ["djl/groups/send", { groupId: "group-1", text: "hi" }],
    ["turn/start", { threadId: "thread-1" }],
    ["djl/terminal/open", {}],
  ])
    assert.deepEqual(guestAdapterRequest(lender, method, params), { kind: "deny" }, method);
});

test("people in the chat cannot use the agent requests", () => {
  // The adapter passes these on only for the agent role (see electron-groups).
  for (const method of ["djl/groups/agent/join", "djl/groups/agent/reply"]) {
    assert.deepEqual(guestAdapterRequest(scope, method, {}), { kind: "deny" });
    assert.deepEqual(guestAdapterRequest(viewer, method, {}), { kind: "deny" });
  }
});

test("a lent agent's gateway lets out its turns and nothing of the chat", () => {
  const out = (message) => allowGuestOutbound(lender, message);
  assert.equal(
    out({ method: "djl/groups/agent/turn", params: { turnId: "t", prompt: "p" } }),
    true,
  );
  assert.equal(out({ method: "djl/groups/agent/cancel", params: { turnId: "t" } }), true);
  assert.equal(out({ id: "join-1", result: {} }), true);
  assert.equal(out({ method: "djl/presence/heartbeat", params: {} }), true);
  assert.equal(out({ method: "djl/groups/event", params: { type: "snapshot" } }), false);
  assert.equal(out({ method: "djl/groups/draft", params: { groupId: "group-1" } }), false);
  assert.equal(
    out({
      method: "item/completed",
      params: { threadId: "thread-1", item: { type: "agentMessage" } },
    }),
    false,
  );
  assert.equal(out({ id: 7, method: "item/commandExecution/requestApproval" }), false);
  // And a person in the chat is never sent another guest's agent turns.
  assert.equal(allowGuestOutbound(scope, { method: "djl/groups/agent/turn", params: {} }), false);
});

test("what the agents did on the owner's computer never reaches a guest", () => {
  const reply = {
    groupId: "group-1",
    replyId: "r1",
    memberId: "group-1-m1",
    status: "ok",
    files: ["/srv/owner/project/.env"],
    commands: ["cat ~/.ssh/id_rsa"],
  };
  const activity = { kind: "reading", detail: "/srv/owner/secret.txt", from: null };
  const mission = {
    id: "mission-1",
    groupId: "group-1",
    goal: "Ship it",
    stats: { files: ["/srv/owner/project/a.ts"], commands: 3, reviews: 1, replies: 2 },
  };
  const list = filterGuestGroupsList(scope, {
    groups: [group("group-1")],
    replies: [reply],
    live: { memberStates: {}, drafts: {}, activities: { "group-1-m1": activity } },
    missions: [mission],
  });
  assert.deepEqual(list.replies[0], { ...reply, files: [], commands: [] });
  assert.deepEqual(list.live.activities["group-1-m1"], { ...activity, detail: null });
  assert.deepEqual(list.missions[0].stats, { files: [], commands: 3, reviews: 1, replies: 2 });

  const event = (value) => filterGuestGroupEvent(scope, value);
  assert.deepEqual(event({ type: "reply.recorded", reply }).reply.files, []);
  assert.deepEqual(event({ type: "reply.recorded", reply }).reply.commands, []);
  assert.equal(
    event({ type: "member.activity", groupId: "group-1", memberId: "group-1-m1", activity })
      .activity.detail,
    null,
  );
  assert.equal(
    event({ type: "member.activity", groupId: "group-1", memberId: "group-1-m1", activity: null })
      .activity,
    null,
  );
  assert.deepEqual(event({ type: "mission.upserted", mission }).mission.stats.files, []);
  // The owner's own phone still gets everything: only a guest's gateway filters.
  assert.deepEqual(reply.files, ["/srv/owner/project/.env"]);
});

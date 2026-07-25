const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRemoteOwnedThreadScope } = require("../src/remote-owned-thread-scope");

test("remote-owned scope hides unrelated Codex threads and persists DJL-created threads", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-remote-thread-scope-"));
  const statePath = path.join(stateDir, "threads.json");

  try {
    const scope = createRemoteOwnedThreadScope({ enabled: true, statePath });

    scope.observeOutbound({
      method: "thread/started",
      params: { thread: { id: "thread-djl", cwd: "/repo" } },
    });

    const filtered = scope.filterThreadListResponse({
      id: "list-1",
      result: {
        data: [
          { id: "thread-codex", cwd: "/repo" },
          { id: "thread-djl", cwd: "/repo" },
        ],
        nextCursor: null,
      },
    });

    assert.deepEqual(
      filtered.result.data.map((thread) => thread.id),
      ["thread-djl"],
    );
    assert.equal(scope.isOwned("thread-codex"), false);
    assert.equal(scope.isOwned("thread-djl"), true);

    const restarted = createRemoteOwnedThreadScope({ enabled: true, statePath });
    assert.equal(restarted.isOwned("thread-djl"), true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("remote-owned scope rejects direct access to unowned threads", () => {
  const scope = createRemoteOwnedThreadScope({ enabled: true, persist: false });
  scope.observeOutbound({
    method: "thread/started",
    params: { thread: { id: "thread-djl" } },
  });

  assert.equal(
    scope.shouldRejectInbound({
      id: "read-djl",
      method: "thread/read",
      params: { threadId: "thread-djl" },
    }),
    false,
  );
  assert.equal(
    scope.shouldRejectInbound({
      id: "read-codex",
      method: "thread/read",
      params: { threadId: "thread-codex" },
    }),
    true,
  );
  assert.equal(
    scope.shouldRejectInbound({
      id: "start-new",
      method: "thread/start",
      params: { cwd: "/repo" },
    }),
    false,
  );
});

test("disabled scope preserves the upstream thread list", () => {
  const scope = createRemoteOwnedThreadScope({ enabled: false, persist: false });
  const response = {
    id: "list-all",
    result: { data: [{ id: "thread-codex" }] },
  };

  assert.equal(scope.filterThreadListResponse(response), response);
  assert.equal(
    scope.shouldRejectInbound({
      method: "thread/read",
      params: { threadId: "thread-codex" },
    }),
    false,
  );
});

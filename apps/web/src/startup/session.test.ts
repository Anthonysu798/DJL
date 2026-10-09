import { describe, expect, it } from "vitest";
import { StartupSession } from "./session";
import { StartupStorage, createStartupDraft } from "./storage";

function setup() {
  const values = new Map<string, string>();
  const storage = new StartupStorage("scope", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  });
  return { storage, session: new StartupSession(storage, "home", null) };
}

describe("startup session", () => {
  it("saves text synchronously and restores the same draft after a restart", () => {
    const { storage, session } = setup();
    session.edit("draft 中文");
    const recovered = new StartupSession(storage, "home", null);
    expect(recovered.draft.text).toBe("draft 中文");
    expect(recovered.draft.id).toBe(session.draft.id);
  });

  it("claims pending Send exactly once, only for its owning thread and known model", () => {
    const { session } = setup();
    session.edit("hello");
    expect(session.requestSend()).toBe(false);
    session.setModel({ provider: "codex", model: "model" });
    expect(session.requestSend()).toBe(true);
    session.bindThread("owner");
    expect(session.claimSend("other")).toBeNull();
    const identity = session.claimSend("owner");
    expect(identity?.messageId).toBe(session.draft.id);
    expect(session.claimSend("owner")).toBeNull();
  });

  it("recovers uncertain sends without automatically submitting them again", () => {
    const { storage, session } = setup();
    session.edit("hello");
    session.setModel({ provider: "codex", model: "model" });
    session.requestSend();
    session.bindThread("owner");
    session.claimSend("owner");
    const recovered = new StartupSession(storage, "home", null);
    expect(recovered.draft.sendState).toBe("uncertain");
    expect(recovered.claimSend("owner")).toBeNull();
    expect(recovered.draft.text).toBe("hello");
  });

  it("cancels pending sends and preserves independent surface drafts", () => {
    const { session } = setup();
    session.edit("home");
    session.setModel({ provider: "codex", model: "model" });
    session.requestSend();
    session.navigate("/work");
    session.edit("work");
    session.navigate("/");
    expect(session.draft.text).toBe("home");
    expect(session.draft.sendState).toBe("editing");
  });

  it("keeps the draft until accepted and uses a new identity after editing an uncertain send", () => {
    const { storage, session } = setup();
    session.edit("hello");
    session.setModel({ provider: "codex", model: "model" });
    session.requestSend();
    session.bindThread("owner");
    const identity = session.claimSend("owner")!;
    session.sendFinished(identity.messageId, false);
    expect(storage.readDraft("home")?.text).toBe("hello");
    session.edit("revised");
    expect(session.draft.id).not.toBe(identity.messageId);
    expect(session.draft.threadId).toBe("owner");
  });

  it("does not auto-send if the durable claim cannot be saved", () => {
    const draft = {
      ...createStartupDraft("home", { provider: "codex", model: "model" }),
      text: "hello",
      sendState: "pending" as const,
      threadId: "owner",
    };
    const storage = new StartupStorage("scope", {
      getItem: () => JSON.stringify({ version: 1, ...draft }),
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    });
    const session = new StartupSession(storage, "home", null);
    expect(session.claimSend("owner")).toBeNull();
    expect(session.status).toBe("storage-error");
  });
});

it("preserves an unsent startup draft when a different cached thread opens", () => {
  const { session, storage } = setup();
  session.edit("unsubmitted local text");
  session.navigate("/other-thread");
  session.finishPreview();
  session.adoptThread("home", "other-thread", "", { provider: "codex", model: "model" });
  expect(storage.readDraft("home")?.text).toBe("unsubmitted local text");
  expect(session.draft.threadId).not.toBe("other-thread");
});

it("blocks repeated automatic claims after a storage failure", () => {
  let failures = 0;
  let failWrites = false;
  let raw: string | null = null;
  const store = new StartupStorage("scope", {
    getItem: () => raw,
    setItem: (_key, value) => {
      if (failWrites) {
        failures++;
        throw new Error("quota");
      }
      raw = value;
    },
    removeItem: () => {
      raw = null;
    },
  });
  const session = new StartupSession(store, "home", null);
  session.edit("hello");
  session.setModel({ provider: "codex", model: "model" });
  session.requestSend();
  session.bindThread("owner");
  failWrites = true;
  let notifications = 0;
  session.subscribe(() => {
    notifications++;
  });
  session.claimSend("owner");
  session.claimSend("owner");
  session.claimSend("owner");
  expect(failures).toBe(1);
  expect(notifications).toBe(1);
});

it("requires review after restarting with a saved pending send", () => {
  const { session, storage } = setup();
  session.edit("pending at shutdown");
  session.setModel({ provider: "codex", model: "model" });
  session.requestSend();
  session.bindThread("owner");
  const recovered = new StartupSession(storage, "home", null);
  expect(recovered.draft.text).toBe("pending at shutdown");
  expect(recovered.draft.sendState).toBe("uncertain");
  expect(recovered.claimSend("owner")).toBeNull();
});

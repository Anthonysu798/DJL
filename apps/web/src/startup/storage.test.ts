import { describe, expect, it } from "vitest";
import { StartupStorage, createStartupDraft, normalizeStartupSnapshot } from "./storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values,
  };
}

describe("startup storage", () => {
  it("keeps profiles and home/Work drafts isolated", () => {
    const storage = memoryStorage();
    const first = new StartupStorage("profile-a", storage);
    const second = new StartupStorage("profile-b", storage);
    const draft = { ...createStartupDraft("home", null), text: "Private draft 中文" };
    expect(first.writeDraft(draft)).toBe(true);
    expect(first.readDraft("home")?.text).toBe(draft.text);
    expect(first.readDraft("work")).toBeNull();
    expect(second.readDraft("home")).toBeNull();
  });

  it("rejects corrupt and oversized draft records without throwing", () => {
    const storage = memoryStorage();
    const store = new StartupStorage("profile", storage);
    const draft = createStartupDraft("home", null);
    store.writeDraft(draft);
    const key = [...storage.values.keys()][0]!;
    for (const invalid of [
      "{",
      JSON.stringify({ ...draft, text: 42 }),
      '"' + "x".repeat(600_000) + '"',
    ]) {
      storage.values.set(key, invalid);
      expect(store.readDraft("home")).toBeNull();
    }
  });

  it("reports persistence failure rather than claiming a draft is saved", () => {
    const store = new StartupStorage("profile", {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(store.writeDraft(createStartupDraft("home", null))).toBe(false);
  });

  it("retains claimed send identity so recovery can prevent automatic duplicate dispatch", () => {
    const store = new StartupStorage("profile", memoryStorage());
    const draft = {
      ...createStartupDraft("home", { provider: "codex", model: "model" }),
      text: "hello",
      threadId: "thread-1",
      sendState: "claimed" as const,
    };
    store.writeDraft(draft);
    expect(store.readDraft("home")).toEqual(draft);
    store.removeDraft("home", "another-id");
    expect(store.readDraft("home")?.id).toBe(draft.id);
    store.removeDraft("home", draft.id);
    expect(store.readDraft("home")).toBeNull();
  });

  it("bounds metadata and excludes arbitrary fields and full histories", () => {
    const snapshot = normalizeStartupSnapshot({
      version: 1,
      savedAt: Date.now(),
      locale: "en",
      theme: "dark",
      sidebarWidth: 9999,
      projects: Array.from({ length: 200 }, (_, i) => ({
        id: `p-${i}`,
        title: "project",
        secret: "secret",
      })),
      threads: Array.from({ length: 200 }, (_, i) => ({
        id: `t-${i}`,
        title: "thread",
        messages: ["private history"],
      })),
      model: null,
      authToken: "secret",
    });
    expect(snapshot?.projects).toHaveLength(32);
    expect(snapshot?.threads).toHaveLength(40);
    expect(snapshot?.sidebarWidth).toBe(400);
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|private history|authToken/);
  });
});

it("never persists extra model fields in a startup draft", () => {
  const storage = memoryStorage();
  const store = new StartupStorage("scope", storage);
  const model = { provider: "codex", model: "model", authToken: "not-for-snapshots" };
  store.writeDraft({ ...createStartupDraft("home", model), model });
  expect([...storage.values.values()].join("")).not.toContain("not-for-snapshots");
});

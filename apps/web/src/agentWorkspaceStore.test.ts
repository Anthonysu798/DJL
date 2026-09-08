import { beforeEach, describe, expect, it } from "vitest";
import { useAgentWorkspaceStore } from "./agentWorkspaceStore";

describe("agent workspaces", () => {
  beforeEach(() =>
    useAgentWorkspaceStore.setState({
      workspaces: [],
      profiles: [],
      activeId: null,
      selectedProfileId: null,
    }),
  );
  it("keeps twenty terminals pinned to their original subscription after renaming", () => {
    const store = useAgentWorkspaceStore.getState();
    const workspace = store.addWorkspace("App", "/tmp/app", null);
    const a = store.addProfile("codex", "Subscription 1");
    const b = store.addProfile("codex", "Subscription 2");
    store.addTerminals(workspace, a, 10, "run");
    store.addTerminals(workspace, b, 10, "run");
    store.renameProfile(a, "Personal");
    const panes = useAgentWorkspaceStore.getState().workspaces[0]!.panes;
    expect(new Set(panes.map((pane) => pane.id)).size).toBe(20);
    expect(panes.filter((pane) => pane.profileId === a)).toHaveLength(10);
    expect(panes.filter((pane) => pane.profileId === b)).toHaveLength(10);
    store.removeProfile(a);
    expect(useAgentWorkspaceStore.getState().profiles).toHaveLength(2);
  });
  it("switches the account for new terminals without changing existing terminal assignments", () => {
    const store = useAgentWorkspaceStore.getState();
    const workspace = store.addWorkspace("App", "/tmp/app", null);
    const a = store.addProfile("codex", "First");
    const b = store.addProfile("claudeAgent", "Second");
    store.addTerminals(workspace, a, 1, "run");
    store.selectProfile(b);
    expect(useAgentWorkspaceStore.getState().selectedProfileId).toBe(b);
    expect(useAgentWorkspaceStore.getState().workspaces[0]!.panes[0]!.profileId).toBe(a);
    store.removeProfile(b);
    expect(useAgentWorkspaceStore.getState().selectedProfileId).toBeNull();
    store.selectProfile("missing");
    expect(useAgentWorkspaceStore.getState().selectedProfileId).toBeNull();
  });
  it("organizes independent workspaces and closes only the selected pane", () => {
    const store = useAgentWorkspaceStore.getState();
    const a = store.addWorkspace("A", "/tmp/a", null);
    const b = store.addWorkspace("B", "/tmp/b", null);
    store.addTerminals(a, null, 5, "run");
    store.addTerminals(b, null, 1, "run");
    const pane = useAgentWorkspaceStore.getState().workspaces[0]!.panes[0]!;
    store.removePane(a, pane.id);
    expect(useAgentWorkspaceStore.getState().workspaces.map((w) => w.panes.length)).toEqual([4, 1]);
    store.removeWorkspace(b);
    expect(useAgentWorkspaceStore.getState().activeId).toBe(a);
  });
});

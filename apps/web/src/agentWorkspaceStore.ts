import type { TerminalAgentProfile } from "@synara/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { randomUUID } from "~/lib/utils";

export interface AgentAccountProfile {
  id: string;
  provider: TerminalAgentProfile["provider"];
  name: string;
}
export interface AgentWorkspacePane {
  id: string;
  profileId: string | null;
  action: TerminalAgentProfile["action"];
}
export interface AgentWorkspace {
  id: string;
  name: string;
  cwd: string;
  projectId: string | null;
  layout: "split" | "grid";
  panes: AgentWorkspacePane[];
}
interface AgentWorkspaceState {
  workspaces: AgentWorkspace[];
  profiles: AgentAccountProfile[];
  activeId: string | null;
  selectedProfileId: string | null;
  selectProfile: (id: string | null) => void;
  addWorkspace: (name: string, cwd: string, projectId: string | null) => string;
  selectWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  removeWorkspace: (id: string) => void;
  setLayout: (id: string, layout: AgentWorkspace["layout"]) => void;
  addProfile: (provider: AgentAccountProfile["provider"], name: string) => string;
  renameProfile: (id: string, name: string) => void;
  removeProfile: (id: string) => void;
  addTerminals: (
    workspaceId: string,
    profileId: string | null,
    count: number,
    action: AgentWorkspacePane["action"],
  ) => void;
  removePane: (workspaceId: string, paneId: string) => void;
}

// Only organization and opaque profile ids are persisted here. Credentials stay with the CLI.
export const useAgentWorkspaceStore = create<AgentWorkspaceState>()(
  persist(
    (set) => ({
      workspaces: [],
      profiles: [],
      activeId: null,
      selectedProfileId: null,
      selectProfile: (id) =>
        set((state) =>
          id === null || state.profiles.some((p) => p.id === id)
            ? { selectedProfileId: id }
            : state,
        ),
      addWorkspace: (name, cwd, projectId) => {
        const id = `agent-workspace-${randomUUID()}`;
        set((state) => ({
          activeId: id,
          workspaces: [
            ...state.workspaces,
            { id, name: name.trim(), cwd: cwd.trim(), projectId, panes: [], layout: "split" },
          ],
        }));
        return id;
      },
      selectWorkspace: (activeId) => set({ activeId }),
      renameWorkspace: (id, name) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === id && name.trim() ? { ...w, name: name.trim() } : w,
          ),
        })),
      removeWorkspace: (id) =>
        set((state) => {
          const workspaces = state.workspaces.filter((w) => w.id !== id);
          return {
            workspaces,
            activeId: state.activeId === id ? (workspaces[0]?.id ?? null) : state.activeId,
          };
        }),
      setLayout: (id, layout) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, layout } : w)),
        })),
      addProfile: (provider, name) => {
        const id = randomUUID();
        set((state) => ({ profiles: [...state.profiles, { id, provider, name: name.trim() }] }));
        return id;
      },
      renameProfile: (id, name) =>
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === id && name.trim() ? { ...p, name: name.trim() } : p,
          ),
        })),
      removeProfile: (id) =>
        set((state) =>
          state.workspaces.some((w) => w.panes.some((p) => p.profileId === id))
            ? state
            : {
                profiles: state.profiles.filter((p) => p.id !== id),
                selectedProfileId: state.selectedProfileId === id ? null : state.selectedProfileId,
              },
        ),
      addTerminals: (workspaceId, profileId, count, action) =>
        set((state) => {
          if (profileId && !state.profiles.some((p) => p.id === profileId)) return state;
          if (![1, 5, 10].includes(count)) return state;
          return {
            workspaces: state.workspaces.map((w) =>
              w.id === workspaceId
                ? {
                    ...w,
                    panes: [
                      ...w.panes,
                      ...Array.from({ length: count }, () => ({
                        id: `terminal-${randomUUID()}`,
                        profileId,
                        action,
                      })),
                    ],
                  }
                : w,
            ),
          };
        }),
      removePane: (workspaceId, paneId) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === workspaceId ? { ...w, panes: w.panes.filter((p) => p.id !== paneId) } : w,
          ),
        })),
    }),
    { name: "djl:agent-workspaces:v1", storage: createJSONStorage(() => localStorage) },
  ),
);

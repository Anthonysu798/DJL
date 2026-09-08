import "../../index.css";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { TerminalEvent, TerminalOpenInput } from "@synara/contracts";
import { workspaceTerminalSessions } from "./workspaceTerminalSessions";
import AgentWorkspacesView from "./AgentWorkspacesView";
import { useAgentWorkspaceStore } from "~/agentWorkspaceStore";
import { terminalRuntimeRegistry } from "../terminal/terminalRuntimeRegistry";
import type { AgentWorkspace } from "~/agentWorkspaceStore";

const backend = vi.hoisted(() => ({
  listeners: new Set<(event: TerminalEvent) => void>(),
  opens: 0,
  acknowledged: 0,
  closes: 0,
  screens: new Map<string, string>(),
}));
vi.mock("~/nativeApi", () => {
  const api = {
    terminal: {
      open: async (input: TerminalOpenInput) => {
        backend.opens++;
        return {
          threadId: input.threadId,
          terminalId: input.terminalId ?? "default",
          cwd: input.cwd,
          status: "running",
          pid: 123,
          history: "",
          headlessQueries: input.headlessQueries,
          screen: input.screenSnapshot ? backend.screens.get(input.terminalId!) : undefined,
          exitCode: null,
          exitSignal: null,
          updatedAt: new Date().toISOString(),
        };
      },
      resize: async () => {},
      write: async () => {},
      close: async () => {
        backend.closes++;
      },
      clear: async () => {},
      ackOutput: async ({ bytes }: { bytes: number }) => {
        backend.acknowledged += bytes;
      },
      onEvent: (listener: (event: TerminalEvent) => void) => {
        backend.listeners.add(listener);
        return () => backend.listeners.delete(listener);
      },
    },
  };
  return { readNativeApi: () => api, ensureNativeApi: () => api };
});
vi.mock("~/wsTransportEvents", () => ({ addWsTransportStateListener: () => () => {} }));

vi.mock("~/components/SidebarHeaderNavigationControls", () => ({
  SidebarHeaderNavigationControls: () => null,
}));

describe("workspace maximize interaction", () => {
  it.each(["grid", "split"] as const)(
    "keeps a lower pane and its restore control stable in %s layout",
    async (layout) => {
      await page.viewport(1300, 800);
      const workspace: AgentWorkspace = {
        id: "maximize-test",
        name: "Maximize test",
        cwd: "/tmp",
        projectId: null,
        layout,
        panes: Array.from({ length: 24 }, (_, index) => ({
          id: `max-${index}`,
          profileId: null,
          action: "run",
        })),
      };
      for (const pane of workspace.panes)
        backend.screens.set(pane.id, `\x1b[2J\x1b[H\x1b[32mTerminal ${pane.id} — 中文 λ\x1b[0m`);
      useAgentWorkspaceStore.setState({
        workspaces: [workspace],
        profiles: [],
        activeId: workspace.id,
      });
      const screen = await render(<AgentWorkspacesView projectId={null} />);
      const canvas = document.querySelector<HTMLElement>(".agent-terminal-canvas")!;
      try {
        canvas.scrollTop = canvas.scrollHeight;
        const last = canvas.lastElementChild!;
        await vi.waitFor(() => expect(last.querySelector(".xterm")).not.toBeNull());
        const originalTerminal = last.querySelector(".xterm");
        for (let i = 0; i < 3; i++) {
          await page.getByRole("button", { name: "Maximize terminal", exact: true }).last().click();
          await expect
            .element(page.getByRole("button", { name: "Restore layout", exact: true }))
            .toBeVisible();
          await page.getByRole("button", { name: "Restore layout", exact: true }).click();
          await vi.waitFor(() =>
            expect(canvas.classList.contains("agent-terminal-maximized")).toBe(false),
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          // Restoring should return to the same pane and preserve its input surface.
          expect(last.getBoundingClientRect().top).toBeLessThan(
            canvas.getBoundingClientRect().bottom,
          );
          expect(last.querySelector(".xterm")).toBe(originalTerminal);
          expect(last.textContent).toContain("Terminal max-23 — 中文 λ");
          expect(last.querySelectorAll("canvas")).toHaveLength(0);
        }
      } finally {
        await screen.unmount();
        terminalRuntimeRegistry.disposeThread(workspace.id);
        await Promise.all(
          workspace.panes.map((pane) => workspaceTerminalSessions.close(workspace.id, pane.id)),
        );
        useAgentWorkspaceStore.setState({ workspaces: [], activeId: null });
      }
    },
  );
});

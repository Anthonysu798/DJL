import "../../index.css";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { TerminalEvent, TerminalOpenInput } from "@synara/contracts";
import type { Terminal } from "@xterm/xterm";
import AgentWorkspacesView from "./AgentWorkspacesView";
import { workspaceTerminalSessions } from "./workspaceTerminalSessions";
import { useAgentWorkspaceStore, type AgentWorkspace } from "~/agentWorkspaceStore";
import { terminalRuntimeRegistry } from "../terminal/terminalRuntimeRegistry";

const backend = vi.hoisted(() => ({
  listeners: new Set<(event: TerminalEvent) => void>(),
  opens: [] as TerminalOpenInput[],
  closes: 0,
  acknowledged: 0,
  writes: [] as string[],
  pids: new Map<string, number>(),
}));
vi.mock("~/nativeApi", () => {
  const api = {
    terminal: {
      open: async (input: TerminalOpenInput) => {
        backend.opens.push(input);
        const terminalId = input.terminalId ?? "default";
        if (!backend.pids.has(terminalId)) backend.pids.set(terminalId, backend.pids.size + 100);
        return {
          threadId: input.threadId,
          terminalId,
          cwd: input.cwd,
          status: "running",
          pid: backend.pids.get(terminalId),
          history: "",
          headlessQueries: input.headlessQueries,
          screen: input.screenSnapshot ? `Ready ${terminalId}\r\n$ ` : undefined,
          exitCode: null,
          exitSignal: null,
          updatedAt: new Date().toISOString(),
        };
      },
      resize: async () => {},
      write: async (input: { threadId: string; terminalId: string; data: string }) => {
        backend.writes.push(input.data);
        for (const listener of backend.listeners)
          listener({
            type: "output",
            threadId: input.threadId,
            terminalId: input.terminalId,
            data: input.data,
            byteLength: new TextEncoder().encode(input.data).length,
            createdAt: new Date().toISOString(),
          });
      },
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

const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const canvas = () =>
  document.querySelector<HTMLElement>('.agent-terminal-canvas[data-active="true"]')!;
const selectWorkspace = (name: string) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("aside button")).find(
    (element) => element.textContent?.startsWith(name),
  );
  expect(button).toBeDefined();
  button!.click();
};
const contents = (terminal: Terminal) =>
  Array.from(
    { length: terminal.buffer.active.length },
    (_, index) => terminal.buffer.active.getLine(index)?.translateToString(true) ?? "",
  ).join("\n");

describe("retained workspace terminal navigation", () => {
  it("keeps 6 Demo and 13 DJL terminals interactive through 30 warm switches and route remounts", async ({
    annotate,
    task,
  }) => {
    await page.viewport(1400, 900);
    const workspaces: AgentWorkspace[] = [6, 13].map((count, index) => ({
      id: `switch-${index}`,
      name: index ? "DJL" : "Demo",
      cwd: "/tmp",
      projectId: null,
      layout: "grid",
      panes: Array.from({ length: count }, (_, pane) => ({
        id: `switch-${index}-${pane}`,
        profileId: null,
        action: "run",
      })),
    }));
    useAgentWorkspaceStore.setState({ workspaces, profiles: [], activeId: workspaces[0]!.id });
    const attach = vi.spyOn(terminalRuntimeRegistry, "attach");
    const identities = new Map<string, Terminal>();
    const canvases = new Map<string, HTMLElement>();
    const capture = () => {
      attach.mock.calls.forEach(([config], index) => {
        const result = attach.mock.results[index];
        if (result?.type !== "return") return;
        const terminal = result.value.terminal as Terminal;
        const previous = identities.get(config.runtimeKey);
        if (previous)
          expect(terminal === previous, `retained xterm ${config.runtimeKey}`).toBe(true);
        else identities.set(config.runtimeKey, terminal);
      });
    };
    const screen = await render(<AgentWorkspacesView projectId={null} />);
    try {
      // Visit every pane once; cold panes may legitimately initialize lazily.
      for (const workspace of workspaces) {
        selectWorkspace(workspace.name);
        await paint();
        const cells = Array.from(canvas().children);
        for (const cell of cells) {
          cell.scrollIntoView({ block: "nearest" });
          await vi.waitFor(() => expect(cell.querySelector(".xterm")).not.toBeNull());
        }
        await paint();
        capture();
        canvases.set(workspace.name, canvas());
      }
      expect(identities.size).toBe(19);
      const opensAfterWarmup = backend.opens.length;
      const snapshotsAfterWarmup = backend.opens.filter((input) => input.screenSnapshot).length;
      const originalPids = [...backend.pids];
      const initialListeners = backend.listeners.size;
      const heapBefore = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize;

      selectWorkspace("Demo");
      await paint();
      capture();
      const demo = identities.get("switch-0::switch-0-5")!;
      canvas().scrollTop = canvas().scrollHeight;
      await paint();
      const workspaceScroll = canvas().scrollTop;
      const scrollback = Array.from({ length: 120 }, (_, index) => `history ${index}\r\n`).join("");
      for (const listener of backend.listeners)
        listener({
          type: "output",
          threadId: "switch-0",
          terminalId: "switch-0-5",
          createdAt: new Date().toISOString(),
          data: scrollback,
          byteLength: new TextEncoder().encode(scrollback).length,
        });
      await vi.waitFor(() => expect(contents(demo)).toContain("history 119"));
      demo.input("unfinished command");
      await vi.waitFor(() => expect(contents(demo)).toContain("unfinished command"));
      demo.scrollToLine(20);
      demo.select(0, 20, 5);
      const terminalScroll = demo.buffer.active.viewportY;
      expect(terminalScroll).toBeGreaterThan(0);
      const selection = demo.getSelection();
      expect(selection).not.toBe("");
      demo.focus();
      expect(document.activeElement).toBe(demo.textarea);

      const durations: number[] = [];
      for (let index = 0; index < 30; index++) {
        const name = index % 2 ? "Demo" : "DJL";
        const start = performance.now();
        selectWorkspace(name);
        await paint();
        durations.push(performance.now() - start);
        expect(canvas() === canvases.get(name)).toBe(true);
        capture();
        expect(canvas().textContent).not.toContain("Connecting");
        expect(backend.opens).toHaveLength(opensAfterWarmup);
        expect(backend.closes).toBe(0);
        expect(document.querySelectorAll(".xterm")).toHaveLength(19);
        if (name === "Demo") {
          expect(canvas().scrollTop).toBe(workspaceScroll);
          expect(document.activeElement).toBe(demo.textarea);
          expect(demo.getSelection()).toBe(selection);
          expect(demo.buffer.active.viewportY).toBe(terminalScroll);
          expect(contents(demo)).toContain("unfinished command");
        }
      }
      expect(backend.opens.filter((input) => input.screenSnapshot)).toHaveLength(
        snapshotsAfterWarmup,
      );
      expect([...backend.pids]).toEqual(originalPids);
      expect(backend.listeners.size).toBe(initialListeners);

      await page.getByRole("button", { name: "Maximize terminal", exact: true }).last().click();
      await expect
        .element(page.getByRole("button", { name: "Restore layout", exact: true }))
        .toBeVisible();
      selectWorkspace("DJL");
      await paint();
      const backgroundData = "\r\ncompleted while hidden\r\n";
      const acknowledgedBefore = backend.acknowledged;
      for (const listener of backend.listeners)
        listener({
          type: "output",
          threadId: "switch-0",
          terminalId: "switch-0-5",
          createdAt: new Date().toISOString(),
          data: backgroundData,
          byteLength: new TextEncoder().encode(backgroundData).length,
        });
      await vi.waitFor(() => expect(backend.acknowledged).toBeGreaterThan(acknowledgedBefore));
      selectWorkspace("Demo");
      await paint();
      await expect
        .element(page.getByRole("button", { name: "Restore layout", exact: true }))
        .toBeVisible();
      await vi.waitFor(() => expect(contents(demo)).toContain("completed while hidden"));

      // Same lifecycle as navigating away to Settings and returning to Workspaces.
      await screen.rerender(<button>Settings placeholder</button>);
      expect(document.querySelector(".agent-terminal-canvas")).toBeNull();
      expect(document.querySelectorAll(".xterm")).toHaveLength(19);
      await screen.rerender(<AgentWorkspacesView projectId={null} />);
      await paint();
      capture();
      await expect
        .element(page.getByRole("button", { name: "Restore layout", exact: true }))
        .toBeVisible();
      expect(canvas().textContent).not.toContain("Connecting");
      expect(backend.opens).toHaveLength(opensAfterWarmup);
      expect(backend.closes).toBe(0);
      expect(backend.listeners.size).toBe(initialListeners);
      await page.getByRole("button", { name: "Restore layout", exact: true }).click();
      await paint();
      expect(canvas().scrollTop).toBe(workspaceScroll);
      expect(backend.writes).toEqual(["unfinished command"]);
      const p95 = durations.toSorted((a, b) => a - b)[Math.ceil(durations.length * 0.95) - 1]!;
      const measurement = {
        environment: "Chromium browser regression with mocked PTY backend",
        terminals: identities.size,
        warmSwitches: durations.length,
        p95Ms: p95,
        targetMs: 100,
        heapBefore,
        heapAfter: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize,
      };
      Object.assign(task.meta, { workspaceSwitching: measurement });
      await annotate(JSON.stringify(measurement));
      // Timing is evidence rather than a CI gate; resource contention affects headless paint times.
      expect(document.querySelectorAll(".xterm")).toHaveLength(19);
    } finally {
      await screen.unmount();
      attach.mockRestore();
      for (const workspace of workspaces) {
        terminalRuntimeRegistry.disposeThread(workspace.id);
        await Promise.all(
          workspace.panes.map((pane) => workspaceTerminalSessions.close(workspace.id, pane.id)),
        );
      }
      useAgentWorkspaceStore.setState({ workspaces: [], activeId: null });
    }
  });
});

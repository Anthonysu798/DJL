import "../../index.css";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import type { TerminalEvent, TerminalOpenInput } from "@synara/contracts";
import { workspaceTerminalSessions } from "./workspaceTerminalSessions";
import { TerminalPane } from "./AgentWorkspacesView";
import { terminalRuntimeRegistry } from "../terminal/terminalRuntimeRegistry";
import type { AgentWorkspace } from "~/agentWorkspaceStore";

const backend = vi.hoisted(() => ({
  listeners: new Set<(event: TerminalEvent) => void>(),
  opens: 0,
  webglCreations: 0,
  acknowledged: 0,
  closes: 0,
  screens: new Map<string, string>(),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: function WebglAddon() {
    backend.webglCreations++;
    throw new Error("Workspace terminals must not allocate GPU texture atlases");
  },
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

const noAction = () => {};
describe("workspace terminal performance", () => {
  it("measures a 24-terminal workspace with a bounded viewport", async ({ annotate }) => {
    await page.viewport(1200, 800);
    const panes = Array.from({ length: 24 }, (_, index) => ({
      id: `perf-${index}`,
      profileId: null,
      action: "run" as const,
    }));
    const workspace: AgentWorkspace = {
      id: "workspace-perf",
      name: "Performance",
      cwd: "/tmp",
      projectId: null,
      layout: "grid",
      panes,
    };
    const start = performance.now();
    const screen = await render(
      <div
        data-testid="perf-viewport"
        data-terminal-scroll-viewport
        style={{
          width: 1000,
          height: 610,
          overflow: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0,1fr))",
          gridAutoRows: 300,
          gap: 10,
        }}
      >
        {panes.map((pane) => (
          <TerminalPane
            key={pane.id}
            workspace={workspace}
            pane={pane}
            profile={undefined}
            maximized={false}
            onMaximize={noAction}
            onClose={noAction}
            onDuplicate={noAction}
          />
        ))}
      </div>,
    );
    try {
      await vi.waitFor(() => expect(backend.opens).toBeGreaterThanOrEqual(24));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const startupMs = performance.now() - start;
      const instances = document.querySelectorAll(".xterm").length;
      expect(instances).toBeGreaterThan(0);
      expect(instances).toBeLessThan(24);
      expect(document.querySelectorAll(".xterm canvas")).toHaveLength(0);
      const firstTerminal = document.querySelector(".xterm");
      const payload = Array.from(
        { length: 512 },
        (_, index) => `line-${index} ${"x".repeat(96)}\r\n`,
      ).join("");
      const bytes = new TextEncoder().encode(payload).length;
      backend.acknowledged = 0;
      const outputStart = performance.now();
      for (const pane of panes) {
        backend.screens.set(pane.id, `\x1b[2J\x1b[HLATEST-${pane.id}`);
        for (const listener of backend.listeners)
          listener({
            type: "output",
            threadId: workspace.id,
            terminalId: pane.id,
            createdAt: new Date().toISOString(),
            data: payload,
            byteLength: bytes,
          });
      }
      await vi.waitFor(
        () => expect(backend.acknowledged).toBeGreaterThanOrEqual(bytes * panes.length),
        { timeout: 15000 },
      );
      const outputMs = performance.now() - outputStart;
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize;
      await annotate(
        JSON.stringify({
          terminals: panes.length,
          xterms: instances,
          startupMs: Math.round(startupMs),
          outputMs: Math.round(outputMs),
          acknowledgedBytes: backend.acknowledged,
          heapBytes: heap,
        }),
      );
      const viewport = document.querySelector<HTMLElement>('[data-testid="perf-viewport"]')!;
      viewport.scrollTop = viewport.scrollHeight;
      await vi.waitFor(() => {
        expect(viewport.textContent).toContain("LATEST-perf-23");
        expect(document.querySelectorAll(".xterm").length).toBeLessThanOrEqual(24);
      });
      expect(backend.closes).toBe(0);
      const opened = backend.opens;
      viewport.scrollTop = 0;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      expect(document.querySelector(".xterm")).toBe(firstTerminal);
      expect(backend.opens).toBe(opened);
      expect(viewport.textContent).not.toContain("Connecting");
      expect(viewport.textContent).toContain("line-511");
      expect(document.querySelectorAll(".xterm canvas")).toHaveLength(0);
      expect(backend.closes).toBe(0);
      expect(backend.webglCreations).toBe(0);
    } finally {
      await screen.unmount();
      terminalRuntimeRegistry.disposeThread(workspace.id);
      await Promise.all(
        panes.map((pane) => workspaceTerminalSessions.close(workspace.id, pane.id)),
      );
    }
  });
});

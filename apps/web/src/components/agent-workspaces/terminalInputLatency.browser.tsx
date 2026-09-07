import "../../index.css";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
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
  keyAt: 0,
  samples: [] as number[],
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
      write: async (input: { threadId: string; terminalId: string; data: string }) => {
        queueMicrotask(() => {
          for (const listener of backend.listeners)
            listener({
              ...input,
              type: "output",
              createdAt: "now",
              byteLength: new TextEncoder().encode(input.data).length,
            });
        });
      },
      close: async () => {
        backend.closes++;
      },
      clear: async () => {},
      ackOutput: async ({ bytes }: { bytes: number }) => {
        backend.acknowledged += bytes;
        if (backend.keyAt) {
          backend.samples.push(performance.now() - backend.keyAt);
          backend.keyAt = 0;
        }
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
it("measures keydown-to-parser latency with real xterm input handling", async ({ annotate }) => {
  await page.viewport(1200, 800);
  const workspace: AgentWorkspace = {
    id: "key-latency",
    name: "Keys",
    cwd: "/tmp",
    projectId: null,
    layout: "grid",
    panes: [{ id: "keys", profileId: null, action: "run" }],
  };
  const screen = await render(
    <div style={{ width: 800, height: 500 }}>
      <TerminalPane
        workspace={workspace}
        pane={workspace.panes[0]!}
        profile={undefined}
        maximized={false}
        onMaximize={noAction}
        onClose={noAction}
        onDuplicate={noAction}
      />
    </div>,
  );
  const recordKey = (event: KeyboardEvent) => {
    if (event.key.length === 1) backend.keyAt = performance.now();
  };
  document.addEventListener("keydown", recordKey, true);
  try {
    await vi.waitFor(() => expect(document.querySelector(".xterm textarea")).not.toBeNull());
    await page.elementLocator(document.querySelector(".xterm-screen")!).click();
    for (const key of "abcdefghijklmnopqrst") {
      const count = backend.samples.length;
      await userEvent.keyboard(key);
      await vi.waitFor(() => expect(backend.samples.length).toBe(count + 1));
    }
    const samples = backend.samples.toSorted((a, b) => a - b);
    await annotate(
      JSON.stringify({
        rendererKeyToParsedMedianMs: samples[10],
        rendererKeyToParsedP95Ms: samples[18],
        samples: samples.length,
      }),
    );
    expect(document.querySelector(".xterm")?.textContent).toContain("abcdefghijklmnopqrst");
  } finally {
    document.removeEventListener("keydown", recordKey, true);
    await screen.unmount();
    terminalRuntimeRegistry.disposeThread(workspace.id);
    await workspaceTerminalSessions.close(workspace.id, "keys");
  }
});

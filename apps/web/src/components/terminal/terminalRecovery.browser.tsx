import "../../index.css";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { ThreadId, type TerminalEvent, type TerminalOpenInput } from "@synara/contracts";
import ThreadTerminalDrawer from "../ThreadTerminalDrawer";
import { selectThreadTerminalState, useTerminalStateStore } from "~/terminalStateStore";
import { terminalRuntimeRegistry } from "./terminalRuntimeRegistry";

const backend = vi.hoisted(() => ({
  opens: [] as TerminalOpenInput[],
  closed: [] as string[],
  listeners: new Set<(event: TerminalEvent) => void>(),
}));
vi.mock("~/nativeApi", () => ({
  readNativeApi: () => ({
    dialogs: { pickFolder: async () => "/tmp/recovered" },
    terminal: {
      open: async (input: TerminalOpenInput) => {
        backend.opens.push(input);
        if (input.cwd === "/missing") throw new Error("Terminal cwd does not exist: /missing");
        return {
          ...input,
          terminalId: input.terminalId ?? "default",
          status: "running",
          pid: 123,
          history: "Recovered shell ready\r\n",
          exitCode: null,
          exitSignal: null,
          updatedAt: new Date().toISOString(),
        };
      },
      onEvent: (listener: (event: TerminalEvent) => void) => {
        backend.listeners.add(listener);
        return () => backend.listeners.delete(listener);
      },
      resize: async () => {},
      write: async () => {},
      ackOutput: async () => {},
    },
  }),
}));
vi.mock("~/wsTransportEvents", () => ({ addWsTransportStateListener: () => () => {} }));
const id = ThreadId.makeUnsafe("recovery-test");
const noop = () => {};
function Fixture() {
  const state = useTerminalStateStore((s) =>
    selectThreadTerminalState(s.terminalStateByThreadId, id),
  );
  return (
    <div style={{ width: 900, height: 500 }}>
      <ThreadTerminalDrawer
        {...state}
        threadId={id}
        cwd="/missing"
        height={500}
        focusRequestId={0}
        onSplitTerminal={noop}
        onSplitTerminalDown={noop}
        onNewTerminal={noop}
        onNewTerminalTab={noop}
        onMoveTerminalToGroup={noop}
        onActiveTerminalChange={noop}
        onCloseTerminal={(terminalId) => {
          backend.closed.push(terminalId);
          useTerminalStateStore.getState().closeTerminal(id, terminalId);
        }}
        onCloseTerminalGroup={noop}
        onHeightChange={noop}
        onResizeTerminalSplit={noop}
        onTerminalMetadataChange={noop}
        onTerminalActivityChange={noop}
        onAddTerminalContext={noop}
      />
    </div>
  );
}
afterEach(() => {
  terminalRuntimeRegistry.disposeThread(id);
  useTerminalStateStore.setState({ terminalStateByThreadId: {} });
  backend.opens.length = 0;
  backend.closed.length = 0;
});
describe("terminal thread recovery", () => {
  it("lets a user choose a valid folder and start the same failed terminal", async () => {
    useTerminalStateStore.getState().openTerminalThreadPage(id, { terminalOnly: true });
    await render(<Fixture />);
    await expect
      .element(page.getByRole("button", { name: "Choose folder", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Choose folder", exact: true }).click();
    await expect.poll(() => backend.opens.at(-1)?.cwd).toBe("/tmp/recovered");
    await expect
      .element(page.getByRole("button", { name: "Retry", exact: true }))
      .not.toBeInTheDocument();
    expect(useTerminalStateStore.getState().terminalStateByThreadId[id]?.terminalCwd).toBe(
      "/tmp/recovered",
    );
    expect(backend.opens.at(-1)?.terminalId).toBe("default");
  });
  it.each([
    ["Codex", "codex"],
    ["Claude Code", "claudeAgent"],
    ["Cursor", "cursor"],
    ["OpenCode", "opencode"],
    ["Kimi", "kimi"],
    ["Grok", "grok"],
  ])("launches %s in its own tab", async (label, harness) => {
    useTerminalStateStore.getState().openTerminalThreadPage(id, { terminalOnly: true });
    useTerminalStateStore.getState().setTerminalCwd(id, "/tmp/recovered");
    await render(<Fixture />);
    await page.getByRole("button", { name: "Launch harness", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    await expect
      .poll(() =>
        backend.opens.some((input) => input.harness === harness && input.cwd === "/tmp/recovered"),
      )
      .toBe(true);
    expect(useTerminalStateStore.getState().terminalStateByThreadId[id]?.terminalIds).toHaveLength(
      2,
    );
  });
  it("retains an exited terminal and restarts it on request", async () => {
    useTerminalStateStore.getState().openTerminalThreadPage(id, { terminalOnly: true });
    useTerminalStateStore.getState().setTerminalCwd(id, "/tmp/recovered");
    await render(<Fixture />);
    await expect.poll(() => backend.opens.length).toBeGreaterThan(0);
    for (const listener of backend.listeners)
      listener({
        type: "exited",
        threadId: id,
        terminalId: "default",
        createdAt: new Date().toISOString(),
        exitCode: 0,
        exitSignal: null,
      });
    await expect
      .element(page.getByRole("button", { name: "Restart terminal", exact: true }))
      .toBeVisible();
    expect(backend.closed).toEqual([]);
    const opensBeforeRetry = backend.opens.length;
    await page.getByRole("button", { name: "Restart terminal", exact: true }).click();
    await expect.poll(() => backend.opens.length).toBeGreaterThan(opensBeforeRetry);
    await expect
      .element(page.getByRole("button", { name: "Restart terminal", exact: true }))
      .not.toBeInTheDocument();
    expect(backend.opens.at(-1)?.terminalId).toBe("default");
  });
});

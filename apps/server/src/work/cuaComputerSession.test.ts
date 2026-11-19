import { afterEach, describe, expect, it } from "vitest";
import { ComputerManager } from "../computer/ComputerManager";
import { FakeComputerBackend } from "../computer/FakeComputerBackend";
import { CuaComputerSession } from "./cuaComputerSession";
const resources: ComputerManager[] = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((manager) => manager.dispose()));
});
function fixture(backend = new FakeComputerBackend()) {
  const manager = new ComputerManager({ backend });
  resources.push(manager);
  return {
    manager,
    session: new CuaComputerSession({
      manager,
      threadId: "fixture-thread",
      sessionKey: "fixture-session",
      provider: "djlCloud",
      workspaceRoot: "/private/tmp",
    }),
  };
}
describe("DJL Cua session authority", () => {
  it("routes the driver's browser tools through the admitted turn and revokes them on Stop", async () => {
    const { manager, session } = fixture(new FakeComputerBackend({ browser: true }));
    const turn = await session.begin({ mode: "request", generation: 0, explicitInvocation: true });
    expect(session.definitions().map((tool) => tool.name)).toContain("computer_browser_state");
    const result = await session.execute("computer_browser_state", {}, turn);
    expect(result.isError).not.toBe(true);
    await manager.setControlEnabled("fixture-thread", false);
    expect(session.definitions()).toEqual([]);
    await expect(session.execute("computer_browser_state", {}, turn)).rejects.toThrow(
      "active Computer turn",
    );
  });
  it("withholds browser tools from desktop-only backends and the restricted native QA catalog", async () => {
    const { session } = fixture();
    await session.begin({ mode: "request", generation: 0, explicitInvocation: true });
    expect(session.definitions().some((tool) => tool.name.startsWith("computer_browser_"))).toBe(
      false,
    );
    const { manager } = fixture(new FakeComputerBackend({ browser: true }));
    const restricted = new CuaComputerSession({
      manager,
      threadId: "browser-restricted-fixture",
      sessionKey: "browser-restricted-session",
      provider: "djlCloud",
      workspaceRoot: "/private/tmp",
      allowedTools: ["computer_get_state"],
    });
    const turn = await restricted.begin({
      mode: "request",
      generation: 0,
      explicitInvocation: true,
    });
    expect(restricted.definitions().map((tool) => tool.name)).toEqual(["computer_get_state"]);
    await expect(restricted.execute("computer_browser_prepare", {}, turn)).rejects.toThrow(
      "Unknown Computer tool",
    );
    await restricted.end();
  });
  it("advertises explicitly allowed direct specialists without exposing the batch tool", async () => {
    const { manager, session: normal } = fixture();
    const restricted = new CuaComputerSession({
      manager,
      threadId: "restricted-fixture-thread",
      sessionKey: "restricted-specialist",
      provider: "djlCloud",
      workspaceRoot: "/private/tmp",
      allowedTools: ["computer_get_state", "computer_select_text"],
    });
    const turn = await restricted.begin({
      mode: "request",
      generation: 0,
      explicitInvocation: true,
    });
    expect(restricted.definitions().map((tool) => tool.name)).toEqual([
      "computer_get_state",
      "computer_select_text",
    ]);
    expect(restricted.definitions()[1]?.inputSchema.required).toEqual(
      expect.arrayContaining(["start", "length"]),
    );
    await expect(restricted.execute("computer_run", { steps: [] }, turn)).rejects.toThrow(
      "Unknown Computer tool",
    );
    await normal.begin({ mode: "request", generation: 0, explicitInvocation: true });
    expect(normal.definitions().some((tool) => tool.name === "computer_select_text")).toBe(false);
    await restricted.end();
    await normal.end();
  });
  it("requires an observed semantic target in the restricted QA catalog", async () => {
    const { manager } = fixture();
    const session = new CuaComputerSession({
      manager,
      threadId: "fixture-thread",
      sessionKey: "restricted",
      provider: "djlCloud",
      workspaceRoot: "/private/tmp",
      allowedTools: ["computer_type_text"],
      requireSemanticTextTarget: true,
    });
    const turn = await session.begin({ mode: "request", generation: 0, explicitInvocation: true });
    expect(session.definitions()[0]?.inputSchema.required).toEqual(
      expect.arrayContaining(["window_id", "ref"]),
    );
    await expect(
      session.execute("computer_type_text", { text: "synthetic", window_id: "fixture" }, turn),
    ).rejects.toThrow("writable ref");
    await session.end();
  });
  it("accepts an observed zero-based ref without bypassing focus-neutral backend checks", async () => {
    const backend = new FakeComputerBackend({
      root: {
        role: "AXTextArea",
        label: "Owned editor",
        value: "",
        description: null,
        frame: { x: 1100, y: 200, width: 300, height: 100 },
        activationPoint: { x: 1150, y: 250 },
        onScreen: true,
        windowId: "fake-calculator",
        editable: true,
        children: [],
      },
    });
    const { manager } = fixture(backend);
    const session = new CuaComputerSession({
      manager,
      threadId: "zero-ref-fixture",
      sessionKey: "zero-ref-session",
      provider: "djlCloud",
      workspaceRoot: "/private/tmp",
      allowedTools: ["computer_get_state", "computer_type_text"],
      requireSemanticTextTarget: true,
      requestApproval: async () => "accept",
    });
    const turn = await session.begin({ mode: "request", generation: 0, explicitInvocation: true });
    const state = await session.execute(
      "computer_get_state",
      { window_id: "fake-calculator", include_screenshot: false },
      turn,
    );
    const observation = state.content.find((item) => item.type === "text");
    expect(observation?.type === "text" && JSON.parse(observation.text).elements).toContainEqual(
      expect.objectContaining({ ref: 0, label: "Owned editor" }),
    );
    const result = await session.execute(
      "computer_type_text",
      {
        text: "owned synthetic input",
        window_id: "fake-calculator",
        ref: 0,
        include_screenshot: false,
      },
      turn,
    );
    const resultText = result.content.find((item) => item.type === "text");
    expect(result.isError).toBe(true);
    expect(resultText?.type === "text" && resultText.text).toContain(
      "cannot guarantee focus-neutral semantic text input",
    );
    expect(backend.callsFor("typeText")).toHaveLength(0);
    await session.end();
  });
  it("binds an explicitly selected history skill without enabling desktop control", async () => {
    const { session } = fixture();
    const historyTurn = await session.begin(
      { mode: "off", generation: 0, explicitInvocation: false },
      true,
    );
    expect(session.canReadActivityHistory(historyTurn)).toBe(true);
    expect(session.definitions()).toEqual([]);
    const plainTurn = await session.begin(undefined, false);
    expect(session.canReadActivityHistory(historyTurn)).toBe(false);
    expect(session.canReadActivityHistory(plainTurn)).toBe(false);
    await session.end();
    expect(session.isCurrentTurn(plainTurn)).toBe(false);
  });
  it("refuses a delayed request from the previous Computer turn", async () => {
    const { session } = fixture();
    const oldTurn = await session.begin({
      mode: "request",
      generation: 0,
      explicitInvocation: true,
    });
    await session.begin({ mode: "request", generation: 0, explicitInvocation: true });
    await expect(session.execute("computer_help", {}, oldTurn)).rejects.toThrow(
      "different Computer turn",
    );
  });

  it("withholds descriptors and refuses exact-name calls outside an admitted turn", async () => {
    const { session } = fixture();
    expect(session.definitions()).toEqual([]);
    await expect(session.execute("computer_list_windows", {})).rejects.toThrow(
      "active Computer turn",
    );
    await session.begin({ mode: "off", generation: 0, explicitInvocation: false });
    expect(session.definitions()).toEqual([]);
  });
  it("revokes old queued generations and never replays them after a later enable", async () => {
    const { manager, session } = fixture();
    await manager.setControlEnabled("fixture-thread", false);
    await manager.setControlEnabled("fixture-thread", true);
    await session.begin({ mode: "request", generation: 0, explicitInvocation: true });
    expect(session.definitions()).toEqual([]);
    const state = await manager.getThreadState("fixture-thread");
    await session.begin({
      mode: "request",
      generation: state.controlGeneration!,
      explicitInvocation: true,
    });
    expect(session.definitions().some((tool) => tool.name === "computer_get_state")).toBe(true);
    await session.end();
    expect(session.definitions()).toEqual([]);
  });
  it("does not let a late terminal callback end a newer turn", async () => {
    const { session } = fixture();
    const first = await session.begin({ mode: "request", generation: 0, explicitInvocation: true });
    const second = await session.begin({
      mode: "request",
      generation: 0,
      explicitInvocation: true,
    });
    expect(first).not.toBe(second);
    await session.end(first);
    expect(session.definitions().length).toBeGreaterThan(0);
  });
  it("removes actions immediately when Stop revokes the manager", async () => {
    const { manager, session } = fixture();
    await session.begin({ mode: "request", generation: 0, explicitInvocation: true });
    expect(session.definitions().length).toBeGreaterThan(0);
    await manager.setControlEnabled("fixture-thread", false);
    expect(session.definitions()).toEqual([]);
    await expect(session.execute("computer_list_windows", {})).rejects.toThrow(
      "active Computer turn",
    );
  });
});

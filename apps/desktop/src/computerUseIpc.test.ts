import { describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { registerComputerUseIpcHandlers, isTrustedComputerUseUrl } from "./computerUseIpc";

describe("computer-use desktop IPC", () => {
  function setup(trusted: boolean) {
    let invoke: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>;
    const request = vi.fn(async () => ({
      method: "stop" as const,
      result: { stoppedSessionIds: [] },
    }));
    registerComputerUseIpcHandlers(
      {
        handle: (_channel, listener) => {
          invoke = listener;
        },
      },
      { request },
      () => trusted,
    );
    return { request, invoke: (input: unknown) => invoke({} as IpcMainInvokeEvent, input) };
  }
  it("rejects non-root senders before entering privileged renderer paths", async () => {
    const test = setup(false);
    await expect(
      test.invoke({
        threadId: "desktop:settings",
        request: { method: "permissions.request", permission: "accessibility" },
      }),
    ).rejects.toThrow("Untrusted");
    expect(test.request).not.toHaveBeenCalled();
  });
  it("supplies renderer origin itself and rejects supplied origin fields", async () => {
    const test = setup(true);
    await test.invoke({ threadId: "desktop:settings", request: { method: "stop" } });
    expect(test.request).toHaveBeenCalledWith(
      "desktop:settings",
      { method: "stop" },
      { origin: "renderer" },
    );
    await expect(
      test.invoke({ threadId: "other", request: { method: "stop" }, origin: "renderer" }),
    ).rejects.toThrow("Invalid");
  });

  it("does not block desktop startup when optional computer history cannot initialize", async () => {
    let invoke!: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>;
    const factory = vi.fn(() => {
      throw new Error("Invalid private history content");
    });
    registerComputerUseIpcHandlers(
      {
        handle: (_channel, listener) => {
          invoke = listener;
        },
      },
      factory,
      () => true,
    );
    expect(factory).not.toHaveBeenCalled();
    const response = await invoke({} as IpcMainInvokeEvent, {
      threadId: "desktop:settings",
      request: { method: "history.list" },
    });
    expect(response).toEqual({
      method: "history.list",
      error: {
        code: "helper-unavailable",
        message: "Native computer use is unavailable on this device",
      },
    });
    expect(JSON.stringify(response)).not.toContain("private history");
  });
});

it("restricts privileged computer IPC to the app entry URL", () => {
  expect(
    isTrustedComputerUseUrl("http://localhost:6733/#/settings", "http://localhost:6733/"),
  ).toBe(true);
  expect(isTrustedComputerUseUrl("https://example.com/", "http://localhost:6733/")).toBe(false);
  expect(
    isTrustedComputerUseUrl("http://localhost:6733/other.html", "http://localhost:6733/"),
  ).toBe(false);
  expect(
    isTrustedComputerUseUrl("synara://app/index.html#/settings", "synara://app/index.html"),
  ).toBe(true);
});

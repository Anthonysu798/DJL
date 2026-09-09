import "../../index.css";

import type { ServerCommandRecord, ServerCommandStreamEvent } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { ServerCommandApprovalSurface } from "./ServerCommandApprovalSurface";

const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: ServerCommandStreamEvent) => void>(),
  resolveCommand: vi.fn(),
}));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    servers: {
      resolveCommand: mocks.resolveCommand,
      onEvent: (listener: (event: ServerCommandStreamEvent) => void) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
      },
    },
  }),
}));

const pendingCommand: ServerCommandRecord = {
  id: "cmd-1" as ServerCommandRecord["id"],
  serverId: "srv-hk" as ServerCommandRecord["serverId"],
  serverName: "hk-edge",
  command: "systemctl restart nginx",
  tier: "approve-each",
  status: "pending",
  requestedAt: Date.now(),
};

function emit(event: ServerCommandStreamEvent) {
  for (const listener of mocks.listeners) listener(event);
}

function pendingCommandNumber(index: number): ServerCommandRecord {
  return {
    ...pendingCommand,
    id: `cmd-${index}` as ServerCommandRecord["id"],
    command: `uptime # ${index}`,
    requestedAt: pendingCommand.requestedAt + index,
  };
}

async function mount() {
  const screen = render(<ServerCommandApprovalSurface />);
  // The subscription is installed in an effect; wait for it before emitting events.
  await vi.waitFor(() => expect(mocks.listeners.size).toBe(1));
  return screen;
}

afterEach(async () => {
  await cleanup();
  mocks.listeners.clear();
  vi.clearAllMocks();
});

describe("ServerCommandApprovalSurface", () => {
  it("shows a pending command, approves it, and drops the card once it finishes", async () => {
    mocks.resolveCommand.mockResolvedValue({ ...pendingCommand, status: "running" });
    await mount();

    emit({ type: "snapshot", pending: [pendingCommand] });
    await expect.element(page.getByText("Agent wants to run a command on hk-edge")).toBeVisible();
    await expect.element(page.getByText("systemctl restart nginx")).toBeVisible();
    await expect.element(page.getByText("Waits up to 15 minutes")).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();
    expect(mocks.resolveCommand).toHaveBeenCalledWith({ id: "cmd-1", decision: "approve" });

    emit({ type: "command-updated", command: { ...pendingCommand, status: "succeeded" } });
    await expect
      .element(page.getByText("Agent wants to run a command on hk-edge"))
      .not.toBeInTheDocument();
  });

  it("denies a command and shows how many more are waiting beyond three", async () => {
    mocks.resolveCommand.mockResolvedValue({ ...pendingCommand, status: "denied" });
    await mount();
    emit({ type: "snapshot", pending: [1, 2, 3, 4].map(pendingCommandNumber) });
    await expect.element(page.getByText("1 more waiting")).toBeVisible();
    await expect.element(page.getByText("uptime # 4")).toBeVisible();
    await expect.element(page.getByText("uptime # 1")).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Deny" }).first().click();
    expect(mocks.resolveCommand).toHaveBeenCalledWith({ id: "cmd-4", decision: "deny" });
  });
});

import { describe, expect, it, vi } from "vitest";

import { finalizeRelaySocketClose } from "./socketLifecycle";

describe("relay socket lifecycle", () => {
  it("marks a disconnected Mac offline without operating on the closing socket", async () => {
    const markRegistryOffline = vi.fn(async () => undefined);

    await finalizeRelaySocketClose("mac", markRegistryOffline);

    expect(markRegistryOffline).toHaveBeenCalledOnce();
  });

  it("does not mark the Mac offline when an iPhone disconnects", async () => {
    const markRegistryOffline = vi.fn(async () => undefined);

    await finalizeRelaySocketClose("iphone", markRegistryOffline);

    expect(markRegistryOffline).not.toHaveBeenCalled();
  });

  it("ignores sockets without relay connection state", async () => {
    const markRegistryOffline = vi.fn(async () => undefined);

    await finalizeRelaySocketClose(undefined, markRegistryOffline);

    expect(markRegistryOffline).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { addWsTransportStateListener, emitWsTransportState } from "./wsTransportEvents";

describe("wsTransportEvents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replays the current state and continues delivering later transitions", () => {
    vi.stubGlobal("window", new EventTarget());
    const listener = vi.fn();

    emitWsTransportState("connecting");
    const unsubscribe = addWsTransportStateListener(listener, { replayCurrent: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith("connecting");

    emitWsTransportState("open");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith("open");

    unsubscribe();
    emitWsTransportState("closed");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

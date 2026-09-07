// FILE: presence.test.ts
// Purpose: Verifies the relay's host presence control frame.
import { describe, expect, it } from "vitest";

import { buildHostPresenceFrame, serializeHostPresenceFrame } from "./presence";

describe("host presence frames", () => {
  it("builds a plaintext control frame with the host state and timestamp", () => {
    expect(buildHostPresenceFrame(true, 1_700_000_000_000)).toEqual({
      kind: "hostPresence",
      online: true,
      at: 1_700_000_000_000,
    });
  });

  it("serializes to JSON the phone can classify by kind", () => {
    const text = serializeHostPresenceFrame(false, 42);
    expect(JSON.parse(text)).toEqual({ kind: "hostPresence", online: false, at: 42 });
    expect(text).toContain('"kind":"hostPresence"');
  });
});

import { describe, expect, it } from "vitest";
import { takeDesktopComputerCredentials } from "./desktopComputerCredentials";

describe("desktop computer host credentials", () => {
  it("consumes both secrets before a child environment can inherit them", () => {
    const env = {
      PATH: "/bin",
      DJL_COMPUTER_USE_BRIDGE_URL: "http://127.0.0.1:1234/computer-use",
      DJL_COMPUTER_USE_BRIDGE_TOKEN: "test-secret",
    };
    const captured = takeDesktopComputerCredentials(env);
    expect(captured).toEqual({ url: "http://127.0.0.1:1234/computer-use", token: "test-secret" });
    expect({ ...env }).toEqual({ PATH: "/bin" });
    expect(takeDesktopComputerCredentials(env)).toEqual({ url: "", token: "" });
    expect(Object.isFrozen(captured)).toBe(true);
  });
});

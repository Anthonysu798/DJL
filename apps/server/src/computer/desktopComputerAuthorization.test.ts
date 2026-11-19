import { describe, expect, it } from "vitest";
import { authorizeDesktopComputerStop } from "./desktopComputerAuthorization";
const owned = {
  mode: "desktop",
  token: "test-desktop-secret",
  authorization: "Bearer test-desktop-secret",
  remoteAddress: "127.0.0.1",
};
describe("desktop Computer Stop authorization", () => {
  it("accepts only the authenticated loopback desktop", () => {
    expect(authorizeDesktopComputerStop(owned)).toBe(true);
    for (const patch of [
      { mode: "web" },
      { token: undefined },
      { authorization: undefined },
      { authorization: "Bearer wrong" },
      { remoteAddress: "192.0.2.1" },
      { remoteAddress: undefined },
    ]) {
      expect(authorizeDesktopComputerStop({ ...owned, ...patch })).toBe(false);
    }
  });
});

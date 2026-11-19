import { describe, expect, it } from "vitest";
import { resolveDjlComputerIntent } from "./djlComputerIntent";
describe("DJL Computer intent", () => {
  it("requires a leading invocation or a structured Computer reference", () => {
    expect(
      resolveDjlComputerIntent({ message: { text: "/computer-use type in the fixture" } }),
    ).toEqual({ mode: "request", explicitInvocation: true });
    expect(
      resolveDjlComputerIntent({
        message: {
          text: "type",
          mentions: [{ name: "Computer", path: "plugin://djl/computer-use" }],
        },
      }).mode,
    ).toBe("request");
    for (const text of [
      "please use /computer-use",
      "```\n/computer-use\n```",
      "> /computer-use",
      "djl_computer_status",
    ])
      expect(resolveDjlComputerIntent({ message: { text } }).mode).toBe("off");
  });
  it("does not let history, automation, or prompt text grant control", () => {
    expect(
      resolveDjlComputerIntent({
        message: {
          text: "review",
          skills: [{ name: "computer-history", path: "builtin://djl/computer-use/history" }],
        },
      }).mode,
    ).toBe("off");
    expect(
      resolveDjlComputerIntent({
        dispatchOrigin: "automation",
        enableComputerControl: true,
        message: { text: "/computer-use" },
      }).mode,
    ).toBe("off");
    expect(
      resolveDjlComputerIntent({ enableComputerControl: true, message: { text: "type" } }).mode,
    ).toBe("chat");
  });
});

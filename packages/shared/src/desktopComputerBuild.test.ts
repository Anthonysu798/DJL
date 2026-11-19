import { computerQaBackendEnvironment } from "./desktopComputerBuild";
import { expect, it } from "vitest";
import { isComputerQaBuild } from "./desktopComputerBuild";
it("recognizes only the explicit embedded QA marker", () => {
  expect(isComputerQaBuild({ djlComputerBuild: "cua-qa" })).toBe(true);
  for (const input of [
    null,
    "cua-qa",
    {},
    { djlComputerBuild: true },
    { djlComputerBuild: "production" },
  ])
    expect(isComputerQaBuild(input)).toBe(false);
});

it("keeps provider secrets and external config out of the isolated backend", () => {
  const base = {
    PATH: "/owned/bin",
    OPENAI_API_KEY: "test-only-key",
    OPENCODE_CONFIG: "/unrelated/config.json",
    OPENCODE_CONFIG_CONTENT: "test-only-config",
    SSH_AUTH_SOCK: "/unrelated/agent",
    SYNARA_AUTH_TOKEN: "old-owner-token",
  };
  expect(computerQaBackendEnvironment(base)).toEqual({ PATH: "/owned/bin" });
  expect(base.OPENAI_API_KEY).toBe("test-only-key");
});

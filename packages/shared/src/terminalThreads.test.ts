// FILE: terminalThreads.test.ts
// Purpose: Verifies shared terminal identity helpers.
// Layer: Shared utility test

import { describe, expect, it } from "vitest";

import {
  deriveTerminalCommandIdentity,
  deriveTerminalProcessIdentity,
  terminalCliKindFromValue,
  resolveTerminalVisualIdentity,
} from "./terminalThreads";

describe("resolveTerminalVisualIdentity", () => {
  it("treats explicit null cliKind as a generic terminal even when the title looks provider-like", () => {
    expect(
      resolveTerminalVisualIdentity({
        cliKind: null,
        fallbackTitle: "Terminal 1",
        title: "Codex 1",
      }),
    ).toMatchObject({
      cliKind: null,
      iconKey: "terminal",
      title: "Codex 1",
    });
  });

  it("still infers provider identity from title when cliKind is omitted", () => {
    expect(
      resolveTerminalVisualIdentity({
        fallbackTitle: "Terminal 1",
        title: "Claude Code",
      }),
    ).toMatchObject({
      cliKind: "claude",
      iconKey: "claude",
      title: "Claude Code",
    });
  });
});

describe("terminal harness identity", () => {
  it.each([
    ["codex", "codex", "Codex CLI"],
    ["claude", "claude", "Claude Code"],
    ["cursor-agent", "cursor", "Cursor"],
    ["opencode", "opencode", "OpenCode"],
    ["kimi", "kimi", "Kimi"],
    ["grok", "grok", "Grok"],
  ])("recognizes %s in commands, processes, and persisted metadata", (command, cliKind, title) => {
    expect(deriveTerminalCommandIdentity(command)).toMatchObject({ cliKind, title });
    expect(deriveTerminalProcessIdentity(`/usr/local/bin/${command}`)).toMatchObject({
      cliKind,
      title,
    });
    expect(terminalCliKindFromValue(cliKind)).toBe(cliKind);
    expect(resolveTerminalVisualIdentity({ title, fallbackTitle: "Terminal" })).toMatchObject({
      cliKind,
      title,
    });
  });
});

it("recognizes native Windows harness executable names", () => {
  expect(deriveTerminalProcessIdentity("C:/tools/kimi.exe")).toMatchObject({ cliKind: "kimi" });
  expect(deriveTerminalCommandIdentity("codex.cmd")).toMatchObject({ cliKind: "codex" });
});

it("recognizes the official Kimi process title", () => {
  expect(deriveTerminalProcessIdentity("kimi-code")).toMatchObject({
    cliKind: "kimi",
    title: "Kimi",
  });
});

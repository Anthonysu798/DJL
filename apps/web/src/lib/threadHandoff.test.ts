import { type ModelSelection } from "@synara/contracts";
import { describe, expect, it } from "vitest";
import {
  buildThreadHandoffImportedMessages,
  resolveAvailableHandoffTargetProviders,
  resolveThreadHandoffTitle,
  resolveThreadHandoffModelSelection,
} from "./threadHandoff";

describe("threadHandoff", () => {
  it("preserves skill and mention references for the destination provider", () => {
    const skills = [{ name: "review", path: "/project/skills/review/SKILL.md" }];
    const mentions = [{ name: "README.md", path: "/project/README.md" }];
    const [imported] = buildThreadHandoffImportedMessages({
      messages: [
        {
          id: "source-message" as never,
          role: "user",
          text: "/review @README.md",
          skills,
          mentions,
          createdAt: "2026-09-08T00:00:00.000Z",
          streaming: false,
        },
      ],
    });
    expect(imported).toMatchObject({ skills, mentions });
  });
  it("does not import protocol-only assistant messages into a handoff", () => {
    const imported = buildThreadHandoffImportedMessages({
      messages: [
        {
          id: "message-1" as never,
          role: "assistant",
          text: '<tool_calls><invoke name="websearch"><parameter name="query">DJL</parameter></invoke></tool_calls>',
          createdAt: "2026-08-01T00:00:00.000Z",
          streaming: false,
        },
      ],
    });

    expect(imported).toEqual([]);
  });

  it("lists all supported handoff targets except the active provider", () => {
    expect(resolveAvailableHandoffTargetProviders("codex")).toEqual([
      "claudeAgent",
      "cursor",
      "gemini",
      "grok",
      "kimi",
      "droid",
      "kilo",
      "opencode",
      "pi",
    ]);
    expect(resolveAvailableHandoffTargetProviders("claudeAgent")).toEqual([
      "codex",
      "cursor",
      "gemini",
      "grok",
      "kimi",
      "droid",
      "kilo",
      "opencode",
      "pi",
    ]);
    expect(resolveAvailableHandoffTargetProviders("cursor")).toEqual([
      "codex",
      "claudeAgent",
      "gemini",
      "grok",
      "kimi",
      "droid",
      "kilo",
      "opencode",
      "pi",
    ]);
    expect(resolveAvailableHandoffTargetProviders("gemini")).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "grok",
      "kimi",
      "droid",
      "kilo",
      "opencode",
      "pi",
    ]);
    expect(resolveAvailableHandoffTargetProviders("grok")).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "gemini",
      "kimi",
      "droid",
      "kilo",
      "opencode",
      "pi",
    ]);
    expect(resolveAvailableHandoffTargetProviders("droid")).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "gemini",
      "grok",
      "kimi",
      "kilo",
      "opencode",
      "pi",
    ]);
    expect(resolveAvailableHandoffTargetProviders("kilo")).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "gemini",
      "grok",
      "kimi",
      "droid",
      "opencode",
      "pi",
    ]);
    expect(resolveAvailableHandoffTargetProviders("opencode")).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "gemini",
      "grok",
      "kimi",
      "droid",
      "kilo",
      "pi",
    ]);
    expect(resolveAvailableHandoffTargetProviders("pi")).toEqual([
      "codex",
      "claudeAgent",
      "cursor",
      "gemini",
      "grok",
      "kimi",
      "droid",
      "kilo",
      "opencode",
    ]);
  });

  it("preserves the source thread title for the created handoff thread", () => {
    expect(resolveThreadHandoffTitle({ title: "General Greeting" })).toBe("General Greeting");
    expect(resolveThreadHandoffTitle({ title: "  Debug   Grok handoff  " })).toBe(
      "Debug Grok handoff",
    );
  });

  it("prefers sticky model selection for the chosen handoff target", () => {
    const stickySelection = {
      provider: "gemini",
      model: "gemini-2.5-pro",
    } satisfies ModelSelection;

    expect(
      resolveThreadHandoffModelSelection({
        sourceThread: {
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-6",
          },
        },
        targetProvider: "gemini",
        projectDefaultModelSelection: {
          provider: "gemini",
          model: "gemini-3.1-pro-preview",
        },
        stickyModelSelectionByProvider: {
          gemini: stickySelection,
        },
      }),
    ).toEqual(stickySelection);
  });

  it("falls back to the resolved provider default model when no sticky or project default exists", () => {
    expect(
      resolveThreadHandoffModelSelection({
        sourceThread: {
          modelSelection: {
            provider: "gemini",
            model: "gemini-2.5-pro",
          },
        },
        targetProvider: "codex",
        projectDefaultModelSelection: null,
        stickyModelSelectionByProvider: {},
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.5",
    });
  });
});

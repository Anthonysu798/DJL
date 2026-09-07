import { describe, expect, it } from "vitest";
import { stripVTControlCharacters } from "node:util";

import { createTerminalModeReplayTracker } from "./terminalModeReplay";

function withTracker<T>(
  test: (tracker: ReturnType<typeof createTerminalModeReplayTracker>) => T,
): T {
  const tracker = createTerminalModeReplayTracker(120, 32);
  try {
    return test(tracker);
  } finally {
    tracker.dispose();
  }
}

describe("createTerminalModeReplayTracker", () => {
  it("answers cursor and device queries without a visible renderer", () => {
    const responses: string[] = [];
    const tracker = createTerminalModeReplayTracker(80, 24, (data) => responses.push(data));
    try {
      tracker.feed("\x1b[4;9H\x1b[6n\x1b[c");
      expect(responses).toContain("\x1b[4;9R");
      expect(responses.some((reply) => reply.startsWith("\x1b[?") && reply.endsWith("c"))).toBe(
        true,
      );
    } finally {
      tracker.dispose();
    }
  });
  it("replays the current agent screen with cursor-positioned spaces and colors", () => {
    withTracker((tracker) => {
      tracker.feed("old screen\u001b[2J\u001b[H\u001b[32mHello\u001b[4Cworld\u001b[0m");
      const screen = tracker.buildScreen();
      expect(stripVTControlCharacters(screen)).toContain("Hello    world");
      expect(screen).not.toContain("old screen");
      expect(screen).toContain("38;5;2");
      withTracker((restored) => {
        restored.feed(screen);
        expect(restored.buildScreen()).toBe(screen);
      });
    });
  });
  it("preserves provider true-color foreground and background through screen replay", () => {
    withTracker((tracker) => {
      tracker.feed("\x1b[38;2;217;119;87mClaude\x1b[0m \x1b[48;2;30;80;130mCodex\x1b[0m");
      const screen = tracker.buildScreen();
      expect(screen).toContain("38;2;217;119;87");
      expect(screen).toContain("48;2;30;80;130");
      withTracker((restored) => {
        restored.feed(screen);
        expect(restored.buildScreen()).toBe(screen);
      });
    });
  });
  it("returns no preamble for default terminal modes", () => {
    withTracker((tracker) => {
      expect(tracker.buildPreamble()).toBe("");
    });
  });

  it("tracks kitty keyboard mode independently of scrollback size", () => {
    withTracker((tracker) => {
      tracker.feed("\u001b[>7u");

      const filler = "x".repeat(2048);
      for (let index = 0; index < 100; index += 1) {
        tracker.feed(filler);
      }

      expect(tracker.buildPreamble()).toBe("\u001b[=7;1u");
    });
  });

  it("drops kitty keyboard mode after explicit pop or zero-set", () => {
    withTracker((tracker) => {
      tracker.feed("\u001b[>7u");
      expect(tracker.buildPreamble()).toBe("\u001b[=7;1u");

      tracker.feed("\u001b[<u");
      expect(tracker.buildPreamble()).toBe("");

      tracker.feed("\u001b[>7u");
      tracker.feed("\u001b[=0;1u");
      expect(tracker.buildPreamble()).toBe("");
    });
  });

  it("tracks bracketed paste, focus reporting, and cursor visibility", () => {
    withTracker((tracker) => {
      tracker.feed("\u001b[?2004h\u001b[?1004h\u001b[?1002h\u001b[?25l");

      const preamble = tracker.buildPreamble();
      expect(preamble).toContain("\u001b[?2004h");
      expect(preamble).toContain("\u001b[?1004h");
      expect(preamble).toContain("\u001b[?25l");

      tracker.feed("\u001b[?2004l");
      expect(tracker.buildPreamble()).not.toContain("?2004");
    });
  });

  it("does not replay mouse tracking modes on renderer reattach", () => {
    withTracker((tracker) => {
      tracker.feed("\u001b[?9h\u001b[?1000h\u001b[?1002h\u001b[?1003h");

      const preamble = tracker.buildPreamble();
      expect(preamble).not.toContain("?9h");
      expect(preamble).not.toContain("?1000h");
      expect(preamble).not.toContain("?1002h");
      expect(preamble).not.toContain("?1003h");
    });
  });

  it("preserves mode state across resizes and split escape feeds", () => {
    withTracker((tracker) => {
      tracker.feed("\u001b[");
      tracker.feed(">7");
      tracker.feed("u");
      tracker.resize(80, 24);
      tracker.resize(80, 24);
      tracker.resize(160, 48);

      expect(tracker.buildPreamble()).toBe("\u001b[=7;1u");
    });
  });
});

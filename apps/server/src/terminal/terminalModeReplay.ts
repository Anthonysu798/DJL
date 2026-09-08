// FILE: terminalModeReplay.ts
// Purpose: Tracks live terminal modes so a fresh renderer can reattach with matching input state.
// Layer: Terminal infrastructure

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Terminal: HeadlessTerminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

export interface TerminalModeReplayTracker {
  feed(data: string): void;
  resize(cols: number, rows: number): void;
  buildPreamble(): string;
  buildScreen(): string;
  dispose(): void;
}

type HeadlessTerminalInternals = {
  _core?: {
    _writeBuffer?: { writeSync(data: string | Uint8Array): void };
    coreService?: { isCursorHidden?: boolean };
    optionsService?: {
      rawOptions: { vtExtensions?: { kittyKeyboard?: boolean } };
    };
  };
};

interface KittyKeyboardReplayState {
  flags: number;
  pendingSequence: string;
  stack: number[];
}

// eslint-disable-next-line no-control-regex -- Parse Kitty keyboard terminal escapes.
const KITTY_KEYBOARD_SEQUENCE_PATTERN = /(?:\u001b\[|\u009b)([<>=])([0-9;]*)u/g;

function parseKittyFlags(rawParams: string): number {
  const firstParam = rawParams.split(";")[0] ?? "";
  const flags = Number(firstParam);
  return Number.isInteger(flags) && flags > 0 ? flags : 0;
}

function retainPotentialKittySequenceTail(input: string, startIndex: number): string {
  const tail = input.slice(startIndex);
  const escCsiIndex = tail.lastIndexOf("\u001b[");
  const c1CsiIndex = tail.lastIndexOf("\u009b");
  const csiIndex = Math.max(escCsiIndex, c1CsiIndex);
  return csiIndex >= 0 ? tail.slice(csiIndex, csiIndex + 128) : "";
}

function feedKittyKeyboardReplayState(state: KittyKeyboardReplayState, data: string): void {
  const input = `${state.pendingSequence}${data}`;
  let processedUntil = 0;
  KITTY_KEYBOARD_SEQUENCE_PATTERN.lastIndex = 0;

  for (const match of input.matchAll(KITTY_KEYBOARD_SEQUENCE_PATTERN)) {
    processedUntil = (match.index ?? 0) + match[0].length;
    const command = match[1];
    if (command === ">") {
      state.stack.push(state.flags);
      state.flags = parseKittyFlags(match[2] ?? "");
    } else if (command === "<") {
      state.flags = state.stack.pop() ?? 0;
    } else if (command === "=") {
      state.flags = parseKittyFlags(match[2] ?? "");
      state.stack.length = 0;
    }
  }

  state.pendingSequence = retainPotentialKittySequenceTail(input, processedUntil);
}

export function createTerminalModeReplayTracker(
  cols: number,
  rows: number,
  onResponse?: (data: string) => void,
): TerminalModeReplayTracker {
  const terminal = new HeadlessTerminal({
    cols,
    rows,
    scrollback: 1,
    allowProposedApi: true,
  });
  const internals = terminal as unknown as HeadlessTerminalInternals;
  const rawOptions = internals._core?.optionsService?.rawOptions;
  const writeBuffer = internals._core?._writeBuffer;

  if (!rawOptions || typeof writeBuffer?.writeSync !== "function") {
    terminal.dispose();
    throw new Error("@xterm/headless internals unavailable for terminal mode replay");
  }

  if (onResponse) terminal.onData(onResponse);
  rawOptions.vtExtensions = { kittyKeyboard: true };
  const kittyKeyboardState: KittyKeyboardReplayState = {
    flags: 0,
    pendingSequence: "",
    stack: [],
  };

  return {
    feed(data) {
      feedKittyKeyboardReplayState(kittyKeyboardState, data);
      writeBuffer.writeSync(data);
    },
    resize(cols, rows) {
      if (terminal.cols === cols && terminal.rows === rows) return;
      terminal.resize(cols, rows);
    },
    buildScreen() {
      const buffer = terminal.buffer.active;
      const parts = [
        buffer.type === "alternate" ? "\u001b[?1049h" : "\u001b[?1049l",
        "\u001b[0m\u001b[?6l\u001b[4l\u001b[?7l\u001b[2J",
      ];
      let previousStyle = "";
      for (let row = 0; row < terminal.rows; row++) {
        const line = buffer.getLine(buffer.baseY + row);
        if (!line) continue;
        parts.push(`\u001b[${row + 1};1H`);
        for (let col = 0; col < terminal.cols; col++) {
          const cell = line.getCell(col);
          if (!cell || cell.getWidth() === 0) continue;
          const attrs = [0];
          if (cell.isBold()) attrs.push(1);
          if (cell.isDim()) attrs.push(2);
          if (cell.isItalic()) attrs.push(3);
          if (cell.isUnderline()) attrs.push(4);
          if (cell.isInverse()) attrs.push(7);
          if (cell.isInvisible()) attrs.push(8);
          if (cell.isStrikethrough()) attrs.push(9);
          for (const [mode, color, rgb, palette] of [
            [38, cell.getFgColor(), cell.isFgRGB(), cell.isFgPalette()],
            [48, cell.getBgColor(), cell.isBgRGB(), cell.isBgPalette()],
          ] as const) {
            if (rgb) attrs.push(mode, 2, (color >>> 16) & 255, (color >>> 8) & 255, color & 255);
            else if (palette) attrs.push(mode, 5, color);
          }
          const style = attrs.join(";");
          if (style !== previousStyle) {
            parts.push(`\u001b[${style}m`);
            previousStyle = style;
          }
          parts.push(cell.getChars() || " ");
        }
      }
      parts.push(
        `\u001b[0m\u001b[${buffer.cursorY + 1};${buffer.cursorX + 1}H\u001b[?7h`,
        this.buildPreamble(),
      );
      return parts.join("");
    },
    buildPreamble() {
      const modes = terminal.modes;
      const parts: string[] = [];

      if (modes.applicationCursorKeysMode) parts.push("\u001b[?1h");
      if (modes.applicationKeypadMode) parts.push("\u001b[?66h");
      if (modes.bracketedPasteMode) parts.push("\u001b[?2004h");
      if (modes.insertMode) parts.push("\u001b[4h");
      if (modes.originMode) parts.push("\u001b[?6h");
      if (modes.reverseWraparoundMode) parts.push("\u001b[?45h");
      if (modes.sendFocusMode) parts.push("\u001b[?1004h");
      if (!modes.wraparoundMode) parts.push("\u001b[?7l");
      if (internals._core?.coreService?.isCursorHidden === true) parts.push("\u001b[?25l");

      // Do not replay mouse tracking modes. After app restart the TUI that
      // enabled mouse reporting may be gone, and reasserting it makes ordinary
      // mouse movement print raw escape sequences into the shell.

      if (kittyKeyboardState.flags > 0) {
        parts.push(`\u001b[=${kittyKeyboardState.flags};1u`);
      }

      return parts.join("");
    },
    dispose() {
      terminal.dispose();
    },
  };
}

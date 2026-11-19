import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { computerQaNativeCallAllowed, readComputerQaWindows } from "./computerQaScope";
const window = {
  id: "cua:123:42",
  pid: 123,
  bundleId: "com.djl.computer-use.electron-fixture",
  appName: "DJL Fixture",
  title: "Synthetic",
  bounds: { x: 0, y: 0, width: 400, height: 300 },
  focused: false,
  minimized: false,
  visible: true,
};
it("fails closed without a private, valid synthetic scope", () => {
  const directory = mkdtempSync(join(tmpdir(), "djl-scope-"));
  const file = join(directory, "scope.json");
  try {
    expect(readComputerQaWindows(file)).toEqual([]);
    writeFileSync(file, JSON.stringify({ version: 1, windows: [window] }), { mode: 0o600 });
    expect(readComputerQaWindows(file)).toHaveLength(1);
    writeFileSync(
      file,
      JSON.stringify({ version: 1, windows: [{ ...window, bundleId: "com.apple.Safari" }] }),
    );
    expect(readComputerQaWindows(file)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("allows only the owned PID/window and refuses global inventory or clipboard", () => {
  expect(computerQaNativeCallAllowed([window], "type_text", { pid: 123, window_id: 42 })).toBe(
    true,
  );
  for (const [name, args] of [
    ["type_text", { pid: 124, window_id: 42 }],
    ["type_text", {}],
    ["list_windows", { pid: 123, window_id: 42 }],
    ["clipboard_read", { pid: 123, window_id: 42 }],
    ["screenshot", {}],
    ["type_text", { pid: 123, window_id: 42, delivery_mode: "foreground" }],
  ] as const)
    expect(computerQaNativeCallAllowed([window], name, args)).toBe(false);
});

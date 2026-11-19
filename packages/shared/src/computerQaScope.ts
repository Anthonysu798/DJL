import { lstatSync, readFileSync } from "node:fs";
import { Schema } from "effect";
import { ComputerWindow } from "@synara/contracts";

const QaWindow = Schema.Struct({ ...ComputerWindow.fields, bundleId: Schema.String });
const Scope = Schema.Struct({ version: Schema.Literal(1), windows: Schema.Array(QaWindow) });
export const COMPUTER_QA_TOOLS = [
  "computer_help",
  "computer_get_state",
  "computer_type_text",
  "computer_set_value",
  "computer_select_text",
  "computer_verify_state",
  "computer_wait",
] as const;
export function readComputerQaWindows(file: string | undefined): readonly (typeof QaWindow.Type)[] {
  if (!file) return [];
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384 || (stat.mode & 0o077) !== 0)
      return [];
    const scope = Schema.decodeUnknownSync(Scope)(JSON.parse(readFileSync(file, "utf8")));
    if (
      scope.windows.length > 8 ||
      scope.windows.some(
        (window) =>
          !window.pid ||
          window.id !== `cua:${window.pid}:${window.id.split(":")[2]}` ||
          !/^cua:[1-9]\d*:[1-9]\d*$/.test(window.id) ||
          !window.bundleId.startsWith("com.djl.computer-use."),
      )
    )
      return [];
    return scope.windows;
  } catch {
    return [];
  }
}
/** Denied calls never reach the driver, including inventory and desktop-wide captures. */
export function computerQaNativeCallAllowed(
  windows: readonly ComputerWindow[],
  name: string,
  args: unknown,
): boolean {
  if (name === "check_permissions" || name === "get_screen_size") return true;
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  const input = args as Record<string, unknown>;
  if (
    name === "list_windows" ||
    name === "list_apps" ||
    name.includes("clipboard") ||
    name.startsWith("browser_") ||
    input.delivery_mode === "foreground"
  )
    return false;
  return windows.some(
    (window) => input.pid === window.pid && input.window_id === Number(window.id.split(":")[2]),
  );
}

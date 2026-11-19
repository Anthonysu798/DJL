export class ToolInputError extends Error {}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function readStringArg(
  args: Record<string, unknown>,
  name: string,
  options?: { readonly required?: boolean },
): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    if (options?.required) throw new ToolInputError(`Missing required argument "${name}".`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError(`Argument "${name}" must be a non-empty string.`);
  }
  return value.trim();
}

/**
 * A string argument taken exactly as written, with no trimming.
 *
 * `readStringArg` trims, which is right for an identifier and wrong for an
 * accessibility label: the desktop targeters match labels verbatim on purpose
 * (`uiTreeTargeting.ts` — "labels keep their surrounding space because nothing
 * trims a label arriving over MCP"), so trimming here silently retargeted a
 * caller that named `"Save "` at a different control called `"Save"`.
 *
 * Still refuses a blank string: a label made only of spaces names nothing, and
 * passing it on would match everything in scope.
 */
export function readVerbatimStringArg(
  args: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolInputError(`Argument "${name}" must be a non-empty string.`);
  }
  return value;
}

export function readNumberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolInputError(`Argument "${name}" must be a number.`);
  }
  return value;
}

export function readBooleanArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ToolInputError(`Argument "${name}" must be a boolean.`);
  }
  return value;
}

export function readRecordArg(
  args: Record<string, unknown>,
  name: string,
): Record<string, unknown> | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`Argument "${name}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function readStringArrayArg(
  args: Record<string, unknown>,
  name: string,
): ReadonlyArray<string> | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new ToolInputError(`Argument "${name}" must be an array of non-empty strings.`);
  }
  return value.map((entry) => (entry as string).trim());
}

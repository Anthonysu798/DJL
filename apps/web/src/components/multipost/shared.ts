import type { MultiPostKind, MultiPostCommand } from "@djl/contracts";
export const kinds: MultiPostKind[] = ["dynamic", "article", "video", "podcast"];
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export type DraftInput = Extract<MultiPostCommand, { action: "save-draft" }>["draft"];
export type CommandRunner = <T = unknown>(input: MultiPostCommand) => Promise<T | undefined>;

export const multiPostViews = [
  "compose",
  "accounts",
  "queue",
  "authorizations",
  "resources",
] as const;
export type MultiPostView = (typeof multiPostViews)[number];

// FILE: groupChat.ts
// Purpose: Pure helpers shared by the group chat server driver and renderer.
// Layer: Shared runtime utilities
// Exports: mention parsing, member handle generation, and group message-id encoding.

export const GROUP_ALL_HANDLE = "all";

const HANDLE_CHAR = /[\p{L}\p{N}_-]/u;
// A mention cannot follow a word character, `.` or `@` (e-mail addresses, paths).
const BLOCKS_MENTION = /[\p{L}\p{N}_.@-]/u;
// After a handle, a Latin letter or digit means a longer, different word (`@Claudette`).
// Other scripts run on without a space (`@审稿人请看`), so they end the handle.
const CONTINUES_WORD = /[A-Za-z0-9_-]/;

/**
 * Finds `@handle` and `@all` mentions; handles are returned in their canonical spelling.
 * `allAliases` are localized spellings of `all`, such as `所有人`.
 */
export function parseGroupMentions(
  text: string,
  handles: readonly string[],
  allAliases: readonly string[] = [],
): { all: boolean; handles: string[] } {
  const ALL = Symbol("all");
  const candidates = [
    ...handles.map((handle) => ({ key: Array.from(handle.toLocaleLowerCase()), value: handle })),
    ...[GROUP_ALL_HANDLE, ...allAliases].map((alias) => ({
      key: Array.from(alias.toLocaleLowerCase()),
      value: ALL,
    })),
  ].toSorted((left, right) => right.key.length - left.key.length);
  const found: string[] = [];
  let all = false;
  const chars = Array.from(text);
  const lower = chars.map((char) => char.toLocaleLowerCase());
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== "@") continue;
    const previous = chars[index - 1];
    if (previous !== undefined && BLOCKS_MENTION.test(previous)) continue;
    const start = index + 1;
    const match = candidates.find(
      ({ key }) =>
        key.length > 0 &&
        key.every((char, offset) => lower[start + offset] === char) &&
        !CONTINUES_WORD.test(chars[start + key.length] ?? ""),
    );
    if (!match) continue;
    if (typeof match.value !== "string") all = true;
    else if (!found.includes(match.value)) found.push(match.value);
    index = start + match.key.length - 1;
  }
  return { all, handles: found };
}

/** A handle without spaces or punctuation, unique (case-insensitively) among `taken`. */
export function nextGroupHandle(base: string, taken: readonly string[]): string {
  const stem = Array.from(base)
    .filter((char) => HANDLE_CHAR.test(char))
    .join("");
  const used = new Set([GROUP_ALL_HANDLE, ...taken.map((handle) => handle.toLocaleLowerCase())]);
  const root = stem || "Agent";
  if (!used.has(root.toLocaleLowerCase())) return root;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${root}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/** Item id a group driver gives one member's reply; ids must not contain `.` or `:`. */
export function formatGroupItemId(memberId: string, replyId: string): string {
  return `gm.${memberId}.${replyId}`;
}

/** Reads the member back out of a thread message id such as `assistant:<turn>:gm.<member>.<reply>`. */
export function parseGroupMessageId(
  messageId: string,
): { memberId: string; replyId: string } | null {
  const match = /(?:^|:)gm\.([^.:]+)\.([^.:]+)$/.exec(messageId);
  return match ? { memberId: match[1]!, replyId: match[2]! } : null;
}

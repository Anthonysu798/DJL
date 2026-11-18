// FILE: groupChat.ts
// Purpose: Pure helpers shared by the group chat server driver and renderer.
// Layer: Shared runtime utilities
// Exports: mention parsing, member handle generation, and group message-id encoding.

export const GROUP_ALL_HANDLE = "all";

const HANDLE_CHAR = /[\p{L}\p{N}_-]/u;
// A mention cannot follow a word character, `.` or `@` (e-mail addresses, paths).
const BLOCKS_MENTION = /[\p{L}\p{N}_.@-]/u;

/** Finds `@handle` and `@all` mentions; handles are returned in their canonical spelling. */
export function parseGroupMentions(
  text: string,
  handles: readonly string[],
): { all: boolean; handles: string[] } {
  const byKey = new Map(handles.map((handle) => [handle.toLocaleLowerCase(), handle]));
  const found: string[] = [];
  let all = false;
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== "@") continue;
    const previous = chars[index - 1];
    if (previous !== undefined && BLOCKS_MENTION.test(previous)) continue;
    let end = index + 1;
    while (end < chars.length && HANDLE_CHAR.test(chars[end]!)) end += 1;
    const word = chars
      .slice(index + 1, end)
      .join("")
      .toLocaleLowerCase();
    if (!word) continue;
    if (word === GROUP_ALL_HANDLE) all = true;
    else {
      const handle = byKey.get(word);
      if (handle && !found.includes(handle)) found.push(handle);
    }
    index = end - 1;
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

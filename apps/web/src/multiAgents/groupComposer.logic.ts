// FILE: groupComposer.logic.ts
// Purpose: The group composer's @ menu and the text the reply actions put in front of the user.
// Layer: Web logic

import type { Group, GroupMember } from "@djl/contracts";
import { GROUP_ALL_HANDLE } from "@djl/shared/groupChat";

import type { GroupChatRow, GroupMemberRow } from "./groupChat.logic";

const QUOTE_LIMIT = 280;
const HANDLE_CHAR = /[\p{L}\p{N}_-]/u;

export type MentionMenuItem = { handle: string; label: string; isAll: boolean };
export type MentionQuery = { start: number; query: string };

export function mentionMenuItems(group: Group, query: string): MentionMenuItem[] {
  const prefix = query.toLocaleLowerCase();
  const items: MentionMenuItem[] = [
    { handle: GROUP_ALL_HANDLE, label: GROUP_ALL_HANDLE, isAll: true },
    ...group.members
      .toSorted((left, right) => left.position - right.position)
      .map((member) => ({ handle: member.handle, label: member.handle, isAll: false })),
  ];
  return items.filter((item) => item.handle.toLocaleLowerCase().startsWith(prefix));
}

/** The `@word` the cursor is inside, if any (not an e-mail address). */
export function activeMentionQuery(text: string, cursor: number): MentionQuery | null {
  const before = Array.from(text.slice(0, cursor));
  let index = before.length - 1;
  while (index >= 0 && HANDLE_CHAR.test(before[index]!)) index -= 1;
  if (index < 0 || before[index] !== "@") return null;
  const previous = before[index - 1];
  if (previous !== undefined && /[\p{L}\p{N}_.@/\\-]/u.test(previous)) return null;
  const start = before.slice(0, index).join("").length;
  return { start, query: before.slice(index + 1).join("") };
}

export function insertMention(
  text: string,
  mention: MentionQuery,
  handle: string,
): { text: string; cursor: number } {
  const end = mention.start + 1 + mention.query.length;
  const inserted = `@${handle} `;
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(end),
    cursor: mention.start + inserted.length,
  };
}

/** Replaces the `$query` the user typed with the chosen skill's `$name` token. */
export function insertSkillToken(
  text: string,
  range: { rangeStart: number; rangeEnd: number },
  name: string,
): { text: string; cursor: number } {
  const inserted = `$${name} `;
  return {
    text: text.slice(0, range.rangeStart) + inserted + text.slice(range.rangeEnd),
    cursor: range.rangeStart + inserted.length,
  };
}

/** The chosen skills whose `$name` token is still in the text (the user may have deleted one). */
export function referencedSkills<T extends { name: string }>(
  text: string,
  chosen: readonly T[],
): T[] {
  return chosen.filter((skill) => {
    let index = text.indexOf(`$${skill.name}`);
    while (index !== -1) {
      const next = text[index + skill.name.length + 1];
      if (next === undefined || !HANDLE_CHAR.test(next)) return true;
      index = text.indexOf(`$${skill.name}`, index + 1);
    }
    return false;
  });
}

export type ComposerToken = { kind: "text" | "mention" | "skill"; text: string };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits composer text into plain runs, `@member` / `@all` mentions and chosen `$skill` tokens. */
export function composerTokens(
  text: string,
  input: { handles: readonly string[]; skillNames: readonly string[] },
): ComposerToken[] {
  const longestFirst = (values: readonly string[]) =>
    values
      .toSorted((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|");
  const mention = `(?<![\\p{L}\\p{N}_.@/\\\\-])@(?:${longestFirst([GROUP_ALL_HANDLE, ...input.handles])})(?![A-Za-z0-9_-])`;
  const skill =
    input.skillNames.length > 0
      ? `|\\$(?:${longestFirst(input.skillNames)})(?![\\p{L}\\p{N}_-])`
      : "";
  const tokens: ComposerToken[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(mention + skill, "giu"))) {
    if (match.index > last) tokens.push({ kind: "text", text: text.slice(last, match.index) });
    tokens.push({ kind: match[0].startsWith("@") ? "mention" : "skill", text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}

const quote = (text: string) =>
  text
    .slice(0, QUOTE_LIMIT)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

export function askAgainText(row: GroupMemberRow, answeredText: string): string {
  return `@${row.handle} ${answeredText}`;
}

export function replyToText(row: GroupMemberRow): string {
  return `@${row.handle}\n${quote(row.text)}\n\n`;
}

export function askAnotherText(row: GroupMemberRow, target: GroupMember, lead: string): string {
  return `@${target.handle} ${lead}\n${quote(row.text)}`;
}

/** The nearest user message above a reply: what the reply answered. */
export function answeredUserText(rows: readonly GroupChatRow[], rowId: string): string {
  const index = rows.findIndex((row) => row.id === rowId);
  for (let position = index - 1; position >= 0; position -= 1) {
    const row = rows[position];
    if (row?.kind === "user") return row.text;
  }
  return "";
}

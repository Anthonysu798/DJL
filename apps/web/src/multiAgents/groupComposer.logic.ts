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

/**
 * An answer as one plain line, for quoting it: no link targets, code blocks, markup or line
 * breaks, and no "@", so a quoted answer never wakes the agents it names.
 */
export function plainExcerpt(text: string, limit = QUOTE_LIMIT): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>|[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/@(?=[\p{L}\p{N}_-])/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}

const quoted = (lead: string, text: string) => {
  const excerpt = plainExcerpt(text);
  return excerpt ? `${lead}\n> ${excerpt}` : lead;
};

export function askAgainText(row: GroupMemberRow, answeredText: string): string {
  return `@${row.handle} ${answeredText}`;
}

/** What is sent for a reply: the user's words to that member, then the answer it replies to. */
export function replyMessageText(row: Pick<GroupMemberRow, "handle" | "text">, typed: string) {
  return quoted(`@${row.handle} ${typed.trim()}`.trim(), row.text);
}

export function askAnotherText(row: GroupMemberRow, target: GroupMember, lead: string): string {
  return quoted(`@${target.handle} ${lead}`, row.text);
}

const isQuote = (line: string) => line === ">" || line.startsWith("> ");

/** A user's message split into what they wrote and the answer it quotes (its "> " lines). */
export function splitQuotedMessage(text: string): { body: string; quote: string } {
  const lines = text.split("\n");
  if (!lines.some(isQuote)) return { body: text, quote: "" };
  return {
    body: lines
      .filter((line) => !isQuote(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    quote: plainExcerpt(lines.filter(isQuote).join("\n")),
  };
}

/** The nearest user message above a reply: what the reply answered. */
/** "@Claude <combine>": one member merges the round's proposals into one plan. */
export function combineText(target: GroupMember, instruction: string): string {
  return `@${target.handle} ${instruction}`;
}

/** "@all <discuss>": everyone reads the others' answers and adds only what is new. */
export function discussText(instruction: string): string {
  return `@${GROUP_ALL_HANDLE} ${instruction}`;
}

export function answeredUserText(rows: readonly GroupChatRow[], rowId: string): string {
  const index = rows.findIndex((row) => row.id === rowId);
  for (let position = index - 1; position >= 0; position -= 1) {
    const row = rows[position];
    if (row?.kind === "user") return row.text;
  }
  return "";
}

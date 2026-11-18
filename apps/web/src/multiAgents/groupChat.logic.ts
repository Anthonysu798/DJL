// FILE: groupChat.logic.ts
// Purpose: Turns a group thread's messages and reply records into labelled chat rows, and holds
//          the small rules the group screen applies (work chip, @all warning, large groups).
// Layer: Web logic

import {
  GROUP_ALL_WARNING_MIN_MEMBERS,
  GROUP_LARGE_WARNING_MEMBERS,
  type ChatAttachment,
  type Group,
  type GroupMemberId,
  type GroupMemberProvider,
  type GroupReply,
  type OrchestrationMessage,
} from "@synara/contracts";
import { parseGroupMentions, parseGroupMessageId } from "@synara/shared/groupChat";

export const GROUP_ALL_ALIASES = ["所有人", "全体成员", "全体"];

export type GroupMemberRow = {
  kind: "member";
  id: string;
  memberId: GroupMemberId;
  handle: string;
  provider: GroupMemberProvider;
  role: string | null;
  text: string;
  status: "ok" | "empty" | "failed";
  error: string | null;
  files: string[];
  commands: string[];
};

export type GroupChatRow =
  | { kind: "user"; id: string; text: string; attachments: readonly ChatAttachment[] }
  | GroupMemberRow
  | { kind: "unknown-member"; id: string; text: string };

export function deriveGroupChatRows(
  messages: readonly OrchestrationMessage[],
  group: Group,
  replies: Readonly<Record<string, GroupReply>>,
): GroupChatRow[] {
  const members = new Map(group.members.map((member) => [member.id as string, member]));
  const rows: GroupChatRow[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      rows.push({
        kind: "user",
        id: message.id,
        text: message.text,
        attachments: message.attachments ?? [],
      });
      continue;
    }
    if (message.role !== "assistant") continue;
    const parsed = parseGroupMessageId(message.id);
    if (!parsed) continue;
    const member = members.get(parsed.memberId);
    if (!member) {
      rows.push({ kind: "unknown-member", id: message.id, text: message.text });
      continue;
    }
    const reply = replies[parsed.replyId];
    rows.push({
      kind: "member",
      id: message.id,
      memberId: member.id,
      handle: member.handle,
      provider: member.provider,
      role: member.role,
      text: message.text,
      status: reply?.status ?? "ok",
      error: reply?.error ?? null,
      files: [...(reply?.files ?? [])],
      commands: [...(reply?.commands ?? [])],
    });
  }
  return rows;
}

export function workChipCounts(row: GroupChatRow): { files: number; commands: number } | null {
  if (row.kind !== "member") return null;
  if (row.files.length === 0 && row.commands.length === 0) return null;
  return { files: row.files.length, commands: row.commands.length };
}

export function shouldConfirmAll(group: Group, text: string): boolean {
  if (group.skipAllWarning || group.members.length < GROUP_ALL_WARNING_MIN_MEMBERS) return false;
  return parseGroupMentions(
    text,
    group.members.map((member) => member.handle),
    GROUP_ALL_ALIASES,
  ).all;
}

export function isLargeGroup(group: Group): boolean {
  return group.members.length >= GROUP_LARGE_WARNING_MEMBERS;
}

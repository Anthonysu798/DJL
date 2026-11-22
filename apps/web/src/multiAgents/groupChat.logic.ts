// FILE: groupChat.logic.ts
// Purpose: Turns a group thread's messages and reply records into labelled chat rows, and holds
//          the small rules the group screen applies (work chip, @all warning, large groups).
// Layer: Web logic

import {
  GROUP_ALL_WARNING_MIN_MEMBERS,
  GROUP_LARGE_WARNING_MEMBERS,
  type Group,
  type GroupMemberId,
  type GroupMemberProvider,
  type GroupReply,
} from "@djl/contracts";
import { parseGroupMentions, parseGroupMessageId } from "@djl/shared/groupChat";

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
  | { kind: "user"; id: string; text: string; images: GroupRowImage[]; fileNames: string[] }
  | GroupMemberRow
  | { kind: "unknown-member"; id: string; text: string };

/** The fields the group view needs from a thread message (server or renderer shape). */
export type GroupSourceMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?:
    | readonly {
        readonly type: string;
        readonly id?: string;
        readonly name?: string;
        readonly previewUrl?: string;
      }[]
    | undefined;
};

/** A sent image the chat can show as a thumbnail and open full size. */
export type GroupRowImage = { id: string; name: string; previewUrl: string };

export function deriveGroupChatRows(
  messages: readonly GroupSourceMessage[],
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
        images: (message.attachments ?? []).flatMap((attachment) =>
          attachment.type === "image" && attachment.id && attachment.previewUrl
            ? [
                {
                  id: attachment.id,
                  name: attachment.name ?? "",
                  previewUrl: attachment.previewUrl,
                },
              ]
            : [],
        ),
        fileNames: (message.attachments ?? []).flatMap((attachment) =>
          attachment.type !== "image" && attachment.name ? [attachment.name] : [],
        ),
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

export type ReplyImage = { src: string; label: string };

const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\((<[^>]+>|[^)\s]+)\)/g;
const IMAGE_ONLY_LINE = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:!?\[[^\]]*\]\((?:<[^>]+>|[^)\s]+)\)\s*)+$/;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg)$/i;

const isLocalImage = (target: string) => {
  const path = target.replace(/^<|>$/g, "");
  return IMAGE_FILE.test(path) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(path);
};

/**
 * The local images a reply shows or links to. With two or more they become a gallery: `images`
 * lists them in order, and `text` is the reply without the lines that only held those images.
 */
export function replyImages(text: string): { text: string; images: ReplyImage[] } {
  const images = new Map<string, ReplyImage>();
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const [, , label = "", src = ""] = match;
    if (isLocalImage(src) && !images.has(src)) images.set(src, { src, label });
  }
  if (images.size < 2) return { text, images: [] };
  const kept = text
    .split("\n")
    .filter(
      (line) =>
        !IMAGE_ONLY_LINE.test(line) ||
        ![...line.matchAll(MARKDOWN_LINK)].every((match) => isLocalImage(match[3] ?? "")),
    )
    .map((line) =>
      line.replace(MARKDOWN_LINK, (whole, bang: string, _label: string, src: string) =>
        bang && isLocalImage(src) ? "" : whole,
      ),
    );
  return {
    text: kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    images: [...images.values()],
  };
}

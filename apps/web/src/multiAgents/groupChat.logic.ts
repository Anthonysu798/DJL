// FILE: groupChat.logic.ts
// Purpose: Turns a group thread's messages and reply records into labelled chat rows, and holds
//          the small rules the group screen applies (work chip, @all warning, large groups,
//          what to offer after a round of proposals, which round's files can be undone).
// Layer: Web logic

import {
  GROUP_ALL_WARNING_MIN_MEMBERS,
  GROUP_LARGE_WARNING_MEMBERS,
  parseGroupGuestMessageId,
  type Group,
  type GroupMemberId,
  type GroupMemberProvider,
  type GroupMission,
  type GroupReaction,
  type GroupReply,
} from "@djl/contracts";
import { parseGroupMentions, parseGroupMessageId } from "@djl/shared/groupChat";

export const GROUP_ALL_ALIASES = ["所有人", "全体成员", "全体"];
/** Messages DJL posted for the user (reactions, missions); they are not shown as bubbles. */
export const GROUP_CUE_MESSAGE_PREFIX = "group-cue-";

export type GroupMemberRow = {
  kind: "member";
  id: string;
  /** The reply record's id: what reactions on this answer point at. */
  replyId: string;
  memberId: GroupMemberId;
  handle: string;
  provider: GroupMemberProvider;
  role: string | null;
  text: string;
  status: "ok" | "empty" | "failed";
  error: string | null;
  files: string[];
  commands: string[];
  /** The member said it had nothing to add. */
  passed: boolean;
  /** The reply answered a round that went to everyone, so it is a proposal. */
  proposeOnly: boolean;
  /** The thread turn (one group round) the reply belongs to. */
  turnId: string | null;
};

export type GroupChatRow =
  | {
      kind: "user";
      id: string;
      text: string;
      images: GroupRowImage[];
      fileNames: string[];
      /** Set when an invited guest wrote this: their name, or "" for a guest since removed. */
      guest?: string;
    }
  | GroupMemberRow
  | { kind: "unknown-member"; id: string; text: string };

/** The fields the group view needs from a thread message (server or renderer shape). */
export type GroupSourceMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  turnId?: string | null | undefined;
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
    if (message.role === "user" && message.id.startsWith(GROUP_CUE_MESSAGE_PREFIX)) continue;
    if (message.role === "user") {
      const guestId = parseGroupGuestMessageId(message.id);
      rows.push({
        kind: "user",
        id: message.id,
        ...(guestId === null
          ? {}
          : { guest: group.guests?.find((entry) => entry.id === guestId)?.name ?? "" }),
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
      replyId: parsed.replyId,
      memberId: member.id,
      handle: member.handle,
      provider: member.provider,
      role: member.role,
      text: message.text,
      status: reply?.status ?? "ok",
      error: reply?.error ?? null,
      files: [...(reply?.files ?? [])],
      commands: [...(reply?.commands ?? [])],
      passed: reply?.passed === true,
      proposeOnly: reply?.proposeOnly === true,
      turnId: message.turnId ?? null,
    });
  }
  return rows;
}

const isProposal = (row: GroupChatRow): row is GroupMemberRow =>
  row.kind === "member" && row.proposeOnly && row.status === "ok" && !row.passed;

/**
 * After a round of two or more proposals, its last reply offers Combine and Discuss. Returns that
 * reply's row id with the members who made the proposals, in the order they answered.
 */
export function proposalRoundEnds(rows: readonly GroupChatRow[]): Map<string, GroupMemberRow[]> {
  const ends = new Map<string, GroupMemberRow[]>();
  let run: GroupMemberRow[] = [];
  let last: GroupChatRow | null = null;
  const close = () => {
    const proposals = run.filter(isProposal);
    const authors = [...new Map(proposals.map((row) => [row.memberId, row])).values()];
    if (authors.length >= 2 && last) ends.set(last.id, authors);
    run = [];
    last = null;
  };
  for (const row of rows) {
    if (row.kind !== "member") {
      close();
      continue;
    }
    run.push(row);
    last = row;
  }
  close();
  return ends;
}

/** The checkpoint fields of one thread turn that the group view reads. */
export type GroupTurnCheckpoint = {
  turnId: string;
  status?: string | undefined;
  files: readonly unknown[];
  checkpointTurnCount?: number | undefined;
};

/**
 * DJL can undo only the newest round that changed files (checkpoints undo one turn at a time).
 * Returns that round's checkpoint turn count and the row its Undo action sits under: the last
 * reply of that round.
 */
export function undoableRound(
  rows: readonly GroupChatRow[],
  checkpoints: readonly GroupTurnCheckpoint[],
): { rowId: string; turnCount: number; files: number } | null {
  const latest = checkpoints
    .filter(
      (checkpoint) =>
        checkpoint.files.length > 0 &&
        (checkpoint.status === undefined || checkpoint.status === "ready") &&
        typeof checkpoint.checkpointTurnCount === "number" &&
        checkpoint.checkpointTurnCount > 0,
    )
    .toSorted((left, right) => (right.checkpointTurnCount ?? 0) - (left.checkpointTurnCount ?? 0))
    .at(0);
  if (!latest) return null;
  const row = rows.findLast((entry) => entry.kind === "member" && entry.turnId === latest.turnId);
  if (!row) return null;
  return { rowId: row.id, turnCount: latest.checkpointTurnCount!, files: latest.files.length };
}

/** Used share of a member's context window, 0–1, or null when its size is unknown. */
export function contextShare(usage: Group["members"][number]["contextUsage"]): number | null {
  if (!usage || !usage.maxTokens) return null;
  return Math.min(1, usage.usedTokens / usage.maxTokens);
}

export function contextLevel(share: number | null): "ok" | "high" | "full" {
  if (share === null || share < 0.7) return "ok";
  return share < 0.85 ? "high" : "full";
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

/** Who reacted how on one message: members by status, and the user's own reactions. */
export type ReactionSummary = {
  members: { memberId: string; kind: "seen" | "done" | "passed" | "failed" }[];
  user: Set<string>;
};

export function reactionSummary(reactions: readonly GroupReaction[] | undefined): ReactionSummary {
  const summary: ReactionSummary = { members: [], user: new Set() };
  for (const reaction of reactions ?? []) {
    if (reaction.actor === "user") summary.user.add(reaction.kind);
    else if (
      reaction.kind === "seen" ||
      reaction.kind === "done" ||
      reaction.kind === "passed" ||
      reaction.kind === "failed"
    )
      summary.members.push({ memberId: reaction.actor, kind: reaction.kind });
  }
  return summary;
}

export type QuestId = "meet" | "askOne" | "react" | "mission";
export const QUEST_ORDER: readonly QuestId[] = ["meet", "askOne", "react", "mission"];

/** The starter quests, worked out from what already happened in the group. */
export function questProgress(input: {
  group: Group;
  rows: readonly GroupChatRow[];
  reactions: Readonly<Record<string, readonly GroupReaction[]>>;
  missions: readonly GroupMission[];
}): Record<QuestId, boolean> {
  const handles = input.group.members.map((member) => member.handle);
  const userTexts = input.rows.flatMap((row) => (row.kind === "user" ? [row.text] : []));
  const mentions = userTexts.map((text) => parseGroupMentions(text, handles, GROUP_ALL_ALIASES));
  const replyIds = new Set(
    input.rows.flatMap((row) => (row.kind === "member" ? [row.replyId] : [])),
  );
  return {
    meet: mentions.some((mention) => mention.all),
    askOne: mentions.some((mention) => !mention.all && mention.handles.length > 0),
    react: [...replyIds].some((replyId) =>
      (input.reactions[replyId] ?? []).some((reaction) => reaction.actor === "user"),
    ),
    mission: input.missions.some(
      (mission) => mission.groupId === input.group.id && mission.startedAt !== null,
    ),
  };
}

export function missionProgress(mission: GroupMission): { done: number; total: number } {
  const counted = mission.steps.filter((step) => step.status !== "skipped");
  return {
    done: counted.filter((step) => step.status === "done").length,
    total: counted.length,
  };
}

/** Missions of this group, oldest first, with the plan reply each belongs under. */
export function groupMissions(
  missions: Readonly<Record<string, GroupMission>>,
  groupId: string,
): GroupMission[] {
  return Object.values(missions)
    .filter((mission) => mission.groupId === groupId)
    .toSorted((left, right) => left.createdAt - right.createdAt);
}

// "- [ ] @Codex build it", "1. @Claude: review it".
const PLAN_STEP_LINE = /^\s*(?:[-*+•]|\d+[.)])\s*(?:\[[ xX]?\]\s*)?\*{0,2}@\S/;

/** A mission plan's reply without its checklist: the mission card under it shows the steps. */
export function planIntroText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !PLAN_STEP_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

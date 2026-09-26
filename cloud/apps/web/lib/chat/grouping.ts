import type { CloudConversation } from "@synara/contracts/cloud";

export interface ConversationGroups {
  readonly pinned: CloudConversation[];
  readonly today: CloudConversation[];
  readonly previous7Days: CloudConversation[];
  readonly older: CloudConversation[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Sidebar sections, newest first. Archived chats are left out; "today" is the local calendar day. */
export function groupConversations(
  conversations: readonly CloudConversation[],
  now: Date,
): ConversationGroups {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = startOfToday - 7 * DAY;
  const groups: ConversationGroups = { pinned: [], today: [], previous7Days: [], older: [] };
  const sorted = conversations
    .filter((c) => !c.archived)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const c of sorted) {
    const at = Date.parse(c.updatedAt);
    if (c.pinned) groups.pinned.push(c);
    else if (at >= startOfToday) groups.today.push(c);
    else if (at >= weekAgo) groups.previous7Days.push(c);
    else groups.older.push(c);
  }
  return groups;
}

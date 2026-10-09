/**
 * Message trees. Editing a user message or regenerating a reply adds a sibling
 * (same parentId), so a conversation is a tree and the view shows one branch:
 * at every fork, the child the user picked, otherwise the newest one.
 */
import type { CloudMessage } from "@synara/contracts/cloud";

/** Key for the children of `parentId`; the conversation's first messages hang off ROOT. */
export const ROOT = "__root__";
export type Selection = Readonly<Record<string, string>>;

export interface MessageTree {
  readonly byId: ReadonlyMap<string, CloudMessage>;
  readonly children: ReadonlyMap<string, readonly CloudMessage[]>;
}

export const parentKey = (message: Pick<CloudMessage, "parentId">): string =>
  message.parentId ?? ROOT;

const byAge = (a: CloudMessage, b: CloudMessage) =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt);

export function buildTree(messages: readonly CloudMessage[]): MessageTree {
  const byId = new Map<string, CloudMessage>();
  const children = new Map<string, CloudMessage[]>();
  for (const message of messages) {
    byId.set(message.id, message);
    const key = parentKey(message);
    const list = children.get(key);
    if (list) list.push(message);
    else children.set(key, [message]);
  }
  for (const list of children.values()) list.sort(byAge);
  return { byId, children };
}

/** The branch on screen, root first. */
export function visibleBranch(tree: MessageTree, selection: Selection): CloudMessage[] {
  const branch: CloudMessage[] = [];
  let key = ROOT;
  for (;;) {
    const kids = tree.children.get(key);
    if (!kids || kids.length === 0) return branch;
    const picked = kids.find((m) => m.id === selection[key]) ?? kids[kids.length - 1]!;
    branch.push(picked);
    key = picked.id;
  }
}

export interface Siblings {
  readonly index: number;
  readonly count: number;
  readonly previousId: string | null;
  readonly nextId: string | null;
}

export function siblingsOf(tree: MessageTree, message: CloudMessage): Siblings {
  const kids = tree.children.get(parentKey(message)) ?? [message];
  const index = Math.max(
    0,
    kids.findIndex((m) => m.id === message.id),
  );
  return {
    index,
    count: kids.length,
    previousId: kids[index - 1]?.id ?? null,
    nextId: kids[index + 1]?.id ?? null,
  };
}

/** Selection that shows `messageId` (and its newest descendants) at its fork. */
export function select(selection: Selection, message: Pick<CloudMessage, "id" | "parentId">) {
  return { ...selection, [parentKey(message)]: message.id };
}

/**
 * Message tree helpers. A conversation's messages form a tree through
 * `parentId`: an edit adds a sibling user message, a regeneration a sibling
 * reply. The user sees one branch, root to leaf.
 */
export interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly createdAt: Date;
}

const oldestFirst = (a: TreeNode, b: TreeNode) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/** Children of each message (roots under `null`), oldest first. */
export function childrenByParent<T extends TreeNode>(nodes: readonly T[]): Map<string | null, T[]> {
  const children = new Map<string | null, T[]>();
  for (const node of nodes.toSorted(oldestFirst)) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  return children;
}

/** Root to `leafId`; empty when the leaf is not in `nodes`. */
export function branchTo<T extends TreeNode>(nodes: readonly T[], leafId: string | null): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const branch: T[] = [];
  for (let node = leafId ? byId.get(leafId) : undefined; node; ) {
    branch.push(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return branch.toReversed();
}

/** The leaf reached from `id` by always following the newest reply. */
export function newestLeaf(nodes: readonly TreeNode[], id: string): string {
  const children = childrenByParent(nodes);
  let leaf = id;
  for (let next = children.get(leaf)?.at(-1); next; next = children.get(leaf)?.at(-1))
    leaf = next.id;
  return leaf;
}

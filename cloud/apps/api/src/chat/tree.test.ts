import { describe, expect, it } from "vitest";

import { branchTo, childrenByParent, newestLeaf } from "./tree.ts";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
// u1 → a1 → u2 → a2
//            └→ u2b (edit) → a2b
//     └→ a1b (regenerate)
const nodes = [
  { id: "u1", parentId: null, createdAt: at(0) },
  { id: "a1", parentId: "u1", createdAt: at(1) },
  { id: "u2", parentId: "a1", createdAt: at(2) },
  { id: "a2", parentId: "u2", createdAt: at(3) },
  { id: "a1b", parentId: "u1", createdAt: at(4) },
  { id: "u2b", parentId: "a1", createdAt: at(5) },
  { id: "a2b", parentId: "u2b", createdAt: at(6) },
];

describe("message tree", () => {
  it("walks a branch from the root to the leaf", () => {
    expect(branchTo(nodes, "a2").map((n) => n.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(branchTo(nodes, "a1b").map((n) => n.id)).toEqual(["u1", "a1b"]);
    expect(branchTo(nodes, "missing")).toEqual([]);
    expect(branchTo(nodes, null)).toEqual([]);
  });

  it("groups siblings oldest first", () => {
    const children = childrenByParent(nodes);
    expect(children.get("u1")!.map((n) => n.id)).toEqual(["a1", "a1b"]);
    expect(children.get("a1")!.map((n) => n.id)).toEqual(["u2", "u2b"]);
    expect(children.get(null)!.map((n) => n.id)).toEqual(["u1"]);
  });

  it("follows the newest reply down to a leaf", () => {
    expect(newestLeaf(nodes, "u1")).toBe("a1b");
    expect(newestLeaf(nodes, "a1")).toBe("a2b");
    expect(newestLeaf(nodes, "u2")).toBe("a2");
    expect(newestLeaf(nodes, "a2")).toBe("a2");
  });
});

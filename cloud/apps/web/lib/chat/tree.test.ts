import type { CloudMessage } from "@synara/contracts/cloud";
import { describe, expect, it } from "vitest";

import { buildTree, ROOT, select, siblingsOf, visibleBranch } from "./tree";

let clock = 0;
const m = (id: string, parentId: string | null, role: "user" | "assistant" = "user") =>
  ({
    id,
    conversationId: "c",
    parentId,
    role,
    parts: [{ type: "text", text: id }],
    model: null,
    runId: null,
    createdAt: new Date(1_700_000_000_000 + clock++ * 1000).toISOString(),
  }) as unknown as CloudMessage;

describe("message tree", () => {
  // u1 → a1, then edit u1 → u1b → a1b, then regenerate a1b → a1c
  const u1 = m("u1", null);
  const a1 = m("a1", "u1", "assistant");
  const u1b = m("u1b", null);
  const a1b = m("a1b", "u1b", "assistant");
  const a1c = m("a1c", "u1b", "assistant");
  const tree = buildTree([a1c, u1, a1, u1b, a1b]);

  it("follows the newest child at every fork by default", () => {
    expect(visibleBranch(tree, {}).map((x) => x.id)).toEqual(["u1b", "a1c"]);
  });

  it("follows the picked sibling and the newest descendants below it", () => {
    expect(visibleBranch(tree, { [ROOT]: "u1" }).map((x) => x.id)).toEqual(["u1", "a1"]);
    const sel = select({}, a1b);
    expect(visibleBranch(tree, sel).map((x) => x.id)).toEqual(["u1b", "a1b"]);
  });

  it("reports the position among siblings for the 2/3 switcher", () => {
    expect(siblingsOf(tree, a1b)).toEqual({ index: 0, count: 2, previousId: null, nextId: "a1c" });
    expect(siblingsOf(tree, u1b)).toEqual({ index: 1, count: 2, previousId: "u1", nextId: null });
  });

  it("ignores a stale selection that points at a message outside the fork", () => {
    expect(visibleBranch(tree, { [ROOT]: "missing" }).map((x) => x.id)).toEqual(["u1b", "a1c"]);
  });
});

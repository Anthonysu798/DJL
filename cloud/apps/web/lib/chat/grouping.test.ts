import type { CloudConversation } from "@synara/contracts/cloud";
import { describe, expect, it } from "vitest";

import { groupConversations } from "./grouping";

const c = (id: string, updatedAt: string, extra: Partial<CloudConversation> = {}) =>
  ({
    id,
    title: id,
    pinned: false,
    archived: false,
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  }) as CloudConversation;
const local = (d: number, h = 12) => new Date(2026, 8, d, h).toISOString();
const ids = (list: readonly CloudConversation[]) => list.map((x) => x.id);

describe("groupConversations", () => {
  it("puts pinned first, then today, previous 7 days, older; skips archived", () => {
    const groups = groupConversations(
      [
        c("old", local(1)),
        c("today-early", local(26, 1)),
        c("pinned-old", local(2), { pinned: true }),
        c("yesterday", local(25)),
        c("today-late", local(26, 14)),
        c("archived", local(26), { archived: true }),
        c("week", local(20)),
      ],
      new Date(2026, 8, 26, 15, 0, 0),
    );
    expect(ids(groups.pinned)).toEqual(["pinned-old"]);
    expect(ids(groups.today)).toEqual(["today-late", "today-early"]);
    expect(ids(groups.previous7Days)).toEqual(["yesterday", "week"]);
    expect(ids(groups.older)).toEqual(["old"]);
  });
});

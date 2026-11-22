import { describe, expect, it } from "vitest";
import type { MultiPostAccount, MultiPostJob } from "@synara/contracts";
import { alreadySent, latestPost, postViewUrl } from "./chatResult";

const account = (extra: Partial<MultiPostAccount> = {}) =>
  ({
    id: "a",
    workspaceId: "w",
    platformKey: "instagram",
    label: "Instagram 3",
    status: "connected",
    identity: { provider: "instagram", accountId: "1", username: "djl.app", verifiedAt: "" },
    createdAt: "",
    ...extra,
  }) as MultiPostAccount;
const job = (extra: Record<string, unknown> = {}) =>
  ({
    id: "j",
    accountId: "a",
    state: "published",
    createdAt: "2026-11-19T23:10:00.000Z",
    evidence: null,
    target: { accountId: "a", adapterId: "x" },
    snapshot: { data: { title: "", content: "Meet DJL 👋\n\n#BuiltWithDJL" } },
    ...extra,
  }) as unknown as MultiPostJob;

describe("where 'View it' goes", () => {
  it("prefers the link the platform returned", () => {
    expect(
      postViewUrl(job({ evidence: { postUrl: "https://www.instagram.com/p/abc/" } }), account()),
    ).toBe("https://www.instagram.com/p/abc/");
  });
  it("falls back to the signed-in profile, where a new post is on top", () => {
    expect(postViewUrl(job(), account())).toBe("https://www.instagram.com/djl.app/");
    expect(
      postViewUrl(
        job(),
        account({
          platformKey: "tiktok",
          identity: { provider: "tiktok", accountId: "1", username: "djl", verifiedAt: "" },
        }),
      ),
    ).toBe("https://www.tiktok.com/@djl");
  });
  it("uses the platform home page when the profile is unknown, and never builds a link from odd names", () => {
    expect(
      postViewUrl(job(), account({ identity: null, homeUrl: "https://www.instagram.com" })),
    ).toBe("https://www.instagram.com");
    expect(
      postViewUrl(
        job(),
        account({
          homeUrl: "https://www.instagram.com",
          identity: { provider: "instagram", accountId: "1", username: "a/../b?x", verifiedAt: "" },
        }),
      ),
    ).toBe("https://www.instagram.com");
    expect(postViewUrl(job(), account({ identity: null }))).toBeUndefined();
    expect(postViewUrl(job(), undefined)).toBeUndefined();
  });
});

describe("what the chat shows", () => {
  it("keeps only the newest post and counts the rest", () => {
    const shown = latestPost([
      job({ id: "old-failed", state: "failed", createdAt: "2026-11-19T21:57:00.000Z" }),
      job({ id: "new-ig", createdAt: "2026-11-19T23:10:00.000Z" }),
      job({ id: "new-tiktok", createdAt: "2026-11-19T23:10:02.000Z" }),
      job({ id: "cancelled", state: "cancelled", createdAt: "2026-11-19T23:30:00.000Z" }),
    ]);
    expect(shown.latest.map((x) => x.id)).toEqual(["new-tiktok", "new-ig"]);
    expect(shown.earlier).toBe(1);
    expect(latestPost([])).toEqual({ latest: [], earlier: 0 });
  });
});

describe("previews that were already sent", () => {
  const captions = { instagram: "Meet DJL 👋 #BuiltWithDJL", tiktok: "Other words" };
  it("matches the caption whatever the line breaks", () => {
    expect(alreadySent(captions, [job()])).toBe(true);
    expect(
      alreadySent({ tiktok: "First line\nThe rest" }, [
        job({ snapshot: { data: { title: "First line", content: "The rest" } } }),
      ]),
    ).toBe(true);
    expect(
      alreadySent(captions, [
        job({ target: { accountId: "a", adapterId: "x", overrides: { content: "Other words" } } }),
      ]),
    ).toBe(true);
  });
  it("does not hide previews that were never sent, were cancelled, or have no caption", () => {
    expect(alreadySent({ instagram: "Something else" }, [job()])).toBe(false);
    expect(alreadySent(captions, [job({ state: "cancelled" })])).toBe(false);
    expect(
      alreadySent({ instagram: "" }, [job({ snapshot: { data: { title: "", content: "" } } })]),
    ).toBe(false);
  });
});

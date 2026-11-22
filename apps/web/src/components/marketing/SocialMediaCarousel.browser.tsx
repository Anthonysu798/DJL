import "../../index.css";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SocialMediaCarousel, SocialMediaOrder } from "./SocialMediaCarousel";
import { SocialWeekCalendar } from "./SocialWeekCalendar";
import { calendarTimeToIso, localCalendarTime } from "./socialCalendar";
import type { SocialInboxItem } from "@djl/contracts";

const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#888"/></svg>',
  );
const media = [
  { id: "two", name: "Second source photo", url: image },
  { id: "one", name: "First source photo", url: image },
];

it("loads every saved image before navigation and preserves explicit photo order", async () => {
  const loaded = vi.fn();
  const screen = await render(<SocialMediaCarousel media={media} onLoad={loaded} />);
  await expect.element(screen.getByRole("img", { name: "Second source photo" })).toBeVisible();
  await expect
    .poll(() => loaded.mock.calls.map((call) => call[0]).toSorted())
    .toEqual(["one", "two"]);
  await screen.getByRole("button", { name: "Next photo" }).click();
  await expect.element(screen.getByRole("img", { name: "First source photo" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Next photo" })).toBeDisabled();
  await screen.unmount();
});
it("moves and removes the exact asset rather than reordering the library", async () => {
  const update = vi.fn();
  const screen = await render(
    <SocialMediaOrder media={media} disabled={false} onChange={update} />,
  );
  await screen.getByRole("button", { name: "Move photo 2 earlier" }).click();
  expect(update).toHaveBeenLastCalledWith(["one", "two"]);
  await screen.getByRole("button", { name: "Remove photo 1", exact: true }).click();
  expect(update).toHaveBeenLastCalledWith(["one"]);
  await screen.unmount();
});
it("opens revision-bound schedule editing from a real calendar entry without changing it", async () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const instant = calendarTimeToIso(localCalendarTime(new Date(), tz).slice(0, 10) + "T12:00", tz);
  const draft = {
    id: "draft",
    userId: "user",
    orgId: "org",
    threadId: "original-chat",
    revision: 4,
    confirmedAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    content: {
      timezone: tz,
      scheduledAt: instant,
      publicationMode: "scheduled",
      caption: "Launch",
      captions: {},
      accountIds: [],
      mediaFileIds: [],
    },
    tasks: [
      {
        id: "task",
        draftId: "draft",
        userId: "user",
        orgId: "org",
        revision: 4,
        accountId: "account",
        state: "queued",
        dueAt: instant,
        postId: null,
        errorCode: null,
        publishStartedAt: null,
        updatedAt: "2026-10-01T00:00:00Z",
      },
    ],
  } satisfies SocialInboxItem["drafts"][number];
  const item = {
    campaignId: "campaign",
    threadId: "original-chat",
    name: "Product launch",
    version: 2,
    drafts: [draft],
    accounts: [],
    issues: [],
    nextScheduledAt: instant,
  } as SocialInboxItem;
  const change = vi.fn();
  const screen = await render(<SocialWeekCalendar items={[item]} onReschedule={change} />);
  await expect
    .element(screen.getByRole("link", { name: "Product launch" }))
    .toHaveAttribute("href", "#/original-chat");
  await screen.getByRole("button", { name: "Change time", exact: true }).click();
  expect(change).toHaveBeenCalledWith(item, draft);
  expect(draft.revision).toBe(4);
  await screen.unmount();
});

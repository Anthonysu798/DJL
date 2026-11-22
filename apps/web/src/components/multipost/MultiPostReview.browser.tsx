import "../../index.css";
import { describe, it, expect, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MultiPostReview } from "./MultiPostReview";
import type { MultiPostDraft, MultiPostAccount } from "@djl/contracts";
const calls = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("./client", () => ({ multiPostCommand: calls.command, mediaPreviewUrl: () => "" }));
const draft: MultiPostDraft = {
  id: "draft",
  workspaceId: "w",
  threadId: "chat",
  revision: 3,
  kind: "dynamic",
  data: { title: "A real post", content: "The exact saved caption" },
  targets: [{ accountId: "a", adapterId: "DYNAMIC_X" }],
  approvedRevision: null,
  publicationMode: "now",
  scheduledAt: null,
  timezone: "America/Toronto",
  createdAt: "2030-01-01T00:00:00Z",
  updatedAt: "2030-01-01T00:00:00Z",
};
const accounts: MultiPostAccount[] = [
  {
    id: "a",
    workspaceId: "w",
    platformKey: "x",
    label: "Personal",
    status: "connected",
    identity: {
      provider: "x",
      accountId: "real",
      username: "real-user",
      verifiedAt: "2030-01-01T00:00:00Z",
    },
    createdAt: "2030-01-01T00:00:00Z",
  },
];
describe("MultiPost human review", () => {
  it("shows the saved target and exact revision before approval then queues that revision", async () => {
    calls.command.mockResolvedValue({});
    render(
      <MultiPostReview threadId="chat" draft={draft} accounts={accounts} onUpdated={() => {}} />,
    );
    await expect.element(page.getByText("The exact saved caption")).toBeVisible();
    await expect.element(page.getByText("@real-user")).toBeVisible();
    expect(calls.command).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect
      .poll(() => calls.command.mock.calls.map((x) => x[1].action))
      .toEqual(["approve-draft", "submit-draft"]);
    expect(calls.command.mock.calls[0]?.[1]).toMatchObject({ draftId: "draft", revision: 3 });
    expect(calls.command.mock.calls[1]?.[1]).toMatchObject({ draftId: "draft", revision: 3 });
  });
});

it("shows target cover, Markdown, Word filename and original/comment flags before approval", async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const image = { name: "Target vertical cover.png", url: canvas.toDataURL(), type: "image/png" };
  render(
    <MultiPostReview
      threadId="chat"
      draft={{
        ...draft,
        data: {
          ...draft.data,
          original: false,
          allowComment: false,
          wordFileData: { name: "Selected original.docx", url: "Media/document" },
        },
        targets: [
          {
            ...draft.targets[0]!,
            overrides: { verticalCover: image, markdownContent: "Exact target Markdown" },
          },
        ],
      }}
      accounts={accounts}
      onUpdated={() => {}}
    />,
  );
  await expect.element(page.getByRole("img", { name: image.name })).toBeVisible();
  await expect.element(page.getByText("Exact target Markdown")).toBeVisible();
  await expect.element(page.getByText("Selected original.docx", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("checkbox", { name: "Original content" })).not.toBeChecked();
  await expect.element(page.getByRole("checkbox", { name: "Allow comments" })).not.toBeChecked();
});

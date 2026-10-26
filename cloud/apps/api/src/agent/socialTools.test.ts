import { describe, expect, it, vi } from "vitest";
import { createSocialTools, type SocialToolServices } from "./socialTools.ts";
import { parseArgs, type ToolContext } from "./tools.ts";
function setup() {
  const list = vi.fn().mockResolvedValue([]);
  const create = vi.fn().mockResolvedValue({ id: "draft", confirmedAt: null, tasks: [] });
  const metrics = vi.fn().mockResolvedValue({ postUrl: null, metrics: { views: null } });
  const accounts = vi
    .fn()
    .mockResolvedValue({ providers: [], accounts: [{ id: "account", provider: "instagram" }] });
  const tools = createSocialTools({
    connections: { list: accounts },
    publishing: { list, create, metrics },
  } as SocialToolServices);
  const ctx = {
    run: { userId: "trusted-user", orgId: "trusted-org", conversationId: "trusted-thread" },
    file: vi.fn().mockResolvedValue({ userId: "trusted-user", orgId: "trusted-org" }),
  } as unknown as ToolContext;
  return { tools, ctx, list, create, metrics, accounts };
}
const draft = {
  caption: "Fixture",
  captions: { account: "Fixture" },
  accountIds: ["account"],
  mediaFileIds: ["file"],
  scheduledAt: "2026-12-01T12:00:00Z",
  timezone: "America/Toronto",
};
describe("social agent tools", () => {
  it("offers no model-accessible confirm, publish, connect, or cancellation capability", () => {
    expect(setup().tools.map((tool) => tool.name)).toEqual([
      "social_publishing_status",
      "prepare_social_draft",
      "social_post_metrics",
    ]);
  });
  it("scopes status to trusted run owner and conversation", async () => {
    const s = setup();
    await s.tools[0]!.run({ userId: "attacker", orgId: "other", threadId: "other" }, s.ctx);
    expect(s.accounts).toHaveBeenCalledWith({ userId: "trusted-user", orgId: "trusted-org" });
    expect(s.list).toHaveBeenCalledWith(
      { userId: "trusted-user", orgId: "trusted-org" },
      "trusted-thread",
    );
    expect(() =>
      parseArgs(s.tools[0]!.parameters, JSON.stringify({ userId: "attacker" })),
    ).toThrow();
  });
  it.each(["userId", "orgId", "threadId", "confirmedAt", "tiktokOptions"])(
    "rejects model-supplied %s",
    async (key) => {
      const s = setup();
      await expect(
        s.tools[1]!.run({ draft_json: JSON.stringify({ ...draft, [key]: "forged" }) }, s.ctx),
      ).rejects.toThrow("unsupported fields");
      expect(s.create).not.toHaveBeenCalled();
    },
  );
  it("creates only an unconfirmed draft bound to trusted conversation", async () => {
    const s = setup();
    const result = await s.tools[1]!.run({ draft_json: JSON.stringify(draft) }, s.ctx);
    expect(s.create).toHaveBeenCalledWith(
      { userId: "trusted-user", orgId: "trusted-org" },
      { ...draft, threadId: "trusted-thread" },
    );
    expect(JSON.parse(result.content)).toMatchObject({
      status: "awaiting_human_review",
      published: false,
    });
  });
  it("rejects files outside this conversation or owner", async () => {
    const s = setup();
    vi.mocked(s.ctx.file).mockResolvedValueOnce(null);
    await expect(s.tools[1]!.run({ draft_json: JSON.stringify(draft) }, s.ctx)).rejects.toThrow(
      "this conversation",
    );
    expect(s.create).not.toHaveBeenCalled();
  });
  it("requires human TikTok settings rather than inferring consent", async () => {
    const s = setup();
    s.accounts.mockResolvedValue({
      providers: [],
      accounts: [{ id: "account", provider: "tiktok" }],
    });
    await expect(s.tools[1]!.run({ draft_json: JSON.stringify(draft) }, s.ctx)).rejects.toThrow(
      "human review card",
    );
    expect(s.create).not.toHaveBeenCalled();
  });
  it("rejects metrics IDs outside the conversation even if owned", async () => {
    const s = setup();
    await expect(s.tools[2]!.run({ task_id: "elsewhere" }, s.ctx)).rejects.toThrow(
      "this conversation",
    );
    expect(s.metrics).not.toHaveBeenCalled();
  });
  it("never returns raw backend exception text", async () => {
    const s = setup();
    s.accounts.mockRejectedValue(new Error("fixture-secret-token"));
    await expect(s.tools[0]!.run({}, s.ctx)).rejects.toThrow(
      "Social publishing could not be completed",
    );
  });
});

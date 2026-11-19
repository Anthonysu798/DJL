import "../../index.css";
import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCampaign } from "@synara/contracts";
import { SocialCampaignLink } from "./SocialCampaignLink";
import { SOCIAL_ACCOUNT_CHANGED } from "./accountCache";
const actions = vi.hoisted(() => ({ agent: vi.fn(), cloud: vi.fn() }));
vi.mock("./agentClient", () => ({ agentCommand: actions.agent }));
vi.mock("./socialPublishingClient", () => ({ publishingCommand: actions.cloud }));
const campaign = { ...createCampaign("Launch"), threadId: "chat" };
const mount = (apply = vi.fn()) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SocialCampaignLink
        campaign={campaign}
        version={2}
        platform="instagram"
        disabled={false}
        onApply={apply}
      />
    </QueryClientProvider>,
  );
describe("campaign links in chat", () => {
  it("keeps public counting off until explicitly selected, then creates a real link and applies only that URL", async () => {
    actions.agent.mockReset();
    actions.cloud.mockReset();
    actions.agent.mockResolvedValue({ url: "https://example.com/product?utm_source=instagram" });
    actions.cloud.mockImplementation(async (_c, _v, input) =>
      input.action === "create-tracking-link"
        ? { trackingUrl: "https://example.invalid/l/aaaaaaaaaaaaaaaaaaaaaa" }
        : [],
    );
    const apply = vi.fn().mockResolvedValue(undefined);
    const screen = await mount(apply);
    await screen.getByText("Campaign link", { exact: true }).click();
    await expect
      .element(screen.getByRole("switch", { name: "Count link opens" }))
      .not.toBeChecked();
    await screen
      .getByLabelText("Website link", { exact: true })
      .fill("https://example.com/product");
    await screen.getByRole("button", { name: "Prepare link", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prepared link" }))
      .toHaveValue("https://example.com/product?utm_source=instagram");
    expect(actions.cloud.mock.calls.some((call) => call[2].action === "create-tracking-link")).toBe(
      false,
    );
    await screen.getByRole("switch", { name: "Count link opens" }).click();
    await screen.getByRole("button", { name: "Prepare link", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prepared link" }))
      .toHaveValue("https://example.invalid/l/aaaaaaaaaaaaaaaaaaaaaa");
    expect(actions.cloud).toHaveBeenCalledWith(campaign, 2, {
      action: "create-tracking-link",
      url: "https://example.com/product?utm_source=instagram",
      expiresInDays: 30,
      disclosureAccepted: true,
    });
    await screen.getByRole("button", { name: "Add to caption" }).click();
    expect(apply).toHaveBeenCalledWith("https://example.invalid/l/aaaaaaaaaaaaaaaaaaaaaa");
    expect(
      actions.cloud.mock.calls.every((call) => !["confirm", "publish"].includes(call[2].action)),
    ).toBe(true);
    await screen.unmount();
  });
  it("discards a late private result when the signed-in account changes", async () => {
    actions.agent.mockReset();
    actions.cloud.mockReset();
    let resolve!: (value: { url: string }) => void;
    actions.agent.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    actions.cloud.mockResolvedValue([]);
    const screen = await mount();
    await screen.getByText("Campaign link", { exact: true }).click();
    await screen
      .getByLabelText("Website link", { exact: true })
      .fill("https://example.com/private-draft");
    await screen.getByRole("button", { name: "Prepare link", exact: true }).click();
    await expect.poll(() => !!resolve).toBe(true);
    window.dispatchEvent(new Event(SOCIAL_ACCOUNT_CHANGED));
    resolve({ url: "https://example.com/private-draft?utm_source=instagram" });
    await expect.element(screen.getByLabelText("Website link", { exact: true })).toHaveValue("");
    await expect
      .element(screen.getByRole("textbox", { name: "Prepared link" }))
      .not.toBeInTheDocument();
    await screen.unmount();
  });
});

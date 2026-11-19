import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SocialConnectionCard } from "./SocialConnectionCard";
import { createCampaign } from "@synara/contracts";
const actions = vi.hoisted(() => ({
  state: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  open: vi.fn(),
}));
vi.mock("./socialClient", () => ({
  socialState: actions.state,
  connectSocial: actions.connect,
  disconnectSocial: actions.disconnect,
}));
vi.mock("~/lib/linkChips", () => ({ openExternalLink: actions.open }));
describe("social account card", () => {
  it("uses a real connect command and opens official authorization without approving publication", async () => {
    actions.state.mockResolvedValue({
      providers: [{ provider: "instagram", available: true, reason: null }],
      accounts: [],
      attempts: [],
    });
    actions.connect.mockResolvedValue({
      authorizationUrl: "https://www.instagram.com/oauth/authorize?state=test",
    });
    const campaign = { ...createCampaign("Launch"), threadId: "chat", platforms: ["instagram"] };
    const screen = await render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SocialConnectionCard campaign={campaign} version={1} />
      </QueryClientProvider>,
    );
    await screen.getByRole("button", { name: "Connect Instagram", exact: true }).click();
    expect(actions.connect).toHaveBeenCalledWith(campaign, 1, "instagram");
    expect(actions.open).toHaveBeenCalledWith(
      "https://www.instagram.com/oauth/authorize?state=test",
    );
    await expect
      .element(screen.getByText("Connecting an account does not publish anything."))
      .toBeVisible();
    await screen.unmount();
  });
  it("recovers a failed status request automatically without remounting or a manual check", async () => {
    actions.state.mockReset();
    actions.state.mockRejectedValueOnce(new Error("Temporary network failure")).mockResolvedValue({
      providers: [{ provider: "instagram", available: true, reason: null }],
      accounts: [
        {
          id: "connected-account",
          provider: "instagram",
          username: "shop",
          displayName: "Recovered Shop",
          status: "connected",
        },
      ],
      attempts: [{ status: "connected" }],
    });
    const campaign = {
      ...createCampaign("Recovery"),
      threadId: "recovery-chat",
      platforms: ["instagram"],
    };
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      },
    });
    const screen = await render(
      <QueryClientProvider client={client}>
        <SocialConnectionCard campaign={campaign} version={1} />
      </QueryClientProvider>,
    );
    try {
      await expect
        .element(screen.getByRole("alert"))
        .toHaveTextContent("Temporary network failure");
      await vi.waitFor(() => expect(actions.state).toHaveBeenCalledTimes(2), {
        timeout: 8000,
        interval: 100,
      });
      await expect.element(screen.getByText(/^Recovered Shop · Connected$/)).toBeVisible();
      await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    } finally {
      await screen.unmount();
      client.clear();
    }
  });
});

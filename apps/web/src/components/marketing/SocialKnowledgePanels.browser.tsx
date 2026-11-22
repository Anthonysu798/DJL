import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createCampaign, defaultBrand } from "@djl/contracts";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { ProductSourcePanel, MediaLibraryPanel, BrandMemoryPanel } from "./SocialKnowledgePanels";
import "../../index.css";

const api = vi.hoisted(() => ({ agent: vi.fn(), command: vi.fn() }));
vi.mock("./agentClient", () => ({ agentCommand: api.agent }));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  command: api.command,
}));
function wrapper(content: React.ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {content}
    </QueryClientProvider>
  );
}
beforeEach(() => {
  api.agent.mockReset();
  api.command.mockReset();
});
describe("social knowledge actions", () => {
  it("loads persisted facts and sends source evidence only after an actual import", async () => {
    const onPrompt = vi.fn(async () => true);
    const product = {
      id: "new-product",
      title: "Desk lamp",
      description: "Warm light",
      sourceUrl: "https://shop.example/lamp",
      facts: [{ field: "title", value: "Desk lamp", sourceUrl: "https://shop.example/lamp" }],
      trust: "untrusted-source",
      retrievedAt: new Date().toISOString(),
      assetIds: ["lamp-image"],
    };
    let imported = false;
    api.agent.mockImplementation(async (_thread, tool) => {
      if (tool === "djl_import_product_url") {
        imported = true;
        return { product, assetIds: ["lamp-image"] };
      }
      return { items: [], assetIds: [], products: imported ? [product] : [] };
    });
    const screen = await render(
      wrapper(<ProductSourcePanel threadId="knowledge-product" onPrompt={onPrompt} />),
    );
    await screen.getByRole("textbox", { name: "Product URL" }).fill("https://shop.example/lamp");
    await screen.getByRole("button", { name: "Import product" }).click();
    await expect.element(screen.getByText("Desk lamp", { exact: true })).toBeVisible();
    expect(onPrompt).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Prepare campaign" }).click();
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("lamp-image"));
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining("https://shop.example/lamp"));
    await screen.unmount();
  });
  it("authorizes an owned asset before updating the current draft version", async () => {
    const asset = {
      id: "owned-image",
      name: "lamp.png",
      mime: "image/png",
      bytes: 20,
      createdAt: new Date().toISOString(),
    };
    api.agent.mockImplementation(async (_thread, _tool, args) =>
      args.action === "reuse"
        ? { assetIds: [asset.id], assets: [asset] }
        : {
            items: [
              {
                asset,
                description: "A lamp",
                tags: ["lamp"],
                transcript: "",
                evidence: "user-provided-labels",
                version: 1,
              },
            ],
            products: [],
            assetIds: [asset.id],
          },
    );
    api.command.mockResolvedValue({ version: 8 });
    const campaign = { value: createCampaign("Draft"), version: 7 };
    const screen = await render(
      wrapper(<MediaLibraryPanel threadId="knowledge-library" campaign={campaign} />),
    );
    await screen.getByRole("button", { name: "Use in draft" }).click();
    await expect.poll(() => api.command.mock.calls.length).toBe(1);
    expect(api.command).toHaveBeenCalledWith({
      action: "update",
      id: campaign.value.id,
      version: 7,
      patch: { assetIds: [asset.id] },
    });
    expect(api.agent).toHaveBeenCalledWith("knowledge-library", "djl_media_library", {
      action: "reuse",
      assetIds: [asset.id],
    });
    await screen.unmount();
  });
  it("indexes current media with user labels and the saved version even during a filtered search", async () => {
    const asset = {
      id: "current-image",
      name: "lamp.png",
      mime: "image/png",
      bytes: 20,
      createdAt: new Date().toISOString(),
    };
    api.agent.mockImplementation(async (_thread, _tool, args) =>
      args.action === "search"
        ? { items: [], assetIds: [] }
        : {
            items: [
              {
                asset,
                description: "Old label",
                tags: [],
                transcript: "",
                evidence: "user-provided-labels",
                version: 9,
              },
            ],
            assetIds: [asset.id],
          },
    );
    const campaign = { value: { ...createCampaign("Draft"), assetIds: [asset.id] }, version: 4 };
    const screen = await render(
      wrapper(
        <MediaLibraryPanel threadId="knowledge-index" campaign={campaign} assets={[asset]} />,
      ),
    );
    await screen.getByRole("textbox", { name: "Search owned media" }).fill("unmatched");
    await screen.getByRole("button", { name: "Search", exact: true }).click();
    await expect.element(screen.getByText("No matching media")).toBeVisible();
    await screen.getByRole("textbox", { name: "Your description" }).fill("A red desk lamp");
    await screen.getByRole("textbox", { name: "Tags, separated by commas" }).fill("red, desk");
    await screen.getByRole("button", { name: "Save to library" }).click();
    await expect.element(screen.getByText("Media saved to your library.")).toBeVisible();
    expect(api.agent).toHaveBeenCalledWith("knowledge-index", "djl_media_library", {
      action: "index",
      assetIds: [asset.id],
      description: "A red desk lamp",
      tags: ["red", "desk"],
      transcript: "",
      version: 9,
    });
    await screen.unmount();
  });
  it("does not update a campaign after library authorization fails", async () => {
    const asset = {
      id: "denied-image",
      name: "lamp.png",
      mime: "image/png",
      bytes: 20,
      createdAt: new Date().toISOString(),
    };
    api.agent.mockImplementation(async (_thread, _tool, args) => {
      if (args.action === "reuse") throw new Error("Media belongs to another workspace.");
      return {
        items: [
          {
            asset,
            description: "A lamp",
            tags: [],
            transcript: "",
            evidence: "user-provided-labels",
            version: 1,
          },
        ],
        assetIds: [asset.id],
      };
    });
    const screen = await render(
      wrapper(
        <MediaLibraryPanel
          threadId="knowledge-denied"
          campaign={{ value: createCampaign("Draft"), version: 1 }}
        />,
      ),
    );
    await screen.getByRole("button", { name: "Use in draft" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("another workspace");
    expect(api.command).not.toHaveBeenCalled();
    await screen.unmount();
  });
  it("saves the edited BrandProfile using the exact loaded version", async () => {
    api.agent.mockImplementation(async (_thread, _tool, args) =>
      args.action === "read"
        ? { profile: { ...defaultBrand, name: "Before" }, version: 4 }
        : { profile: args.profile, version: 5 },
    );
    const screen = await render(wrapper(<BrandMemoryPanel threadId="knowledge-brand" />));
    await expect.element(screen.getByRole("textbox", { name: "Brand name" })).toHaveValue("Before");
    await screen.getByRole("textbox", { name: "Brand name" }).fill("After");
    await screen.getByRole("button", { name: "Save brand memory" }).click();
    await expect.element(screen.getByText("Brand memory saved.")).toBeVisible();
    expect(api.agent).toHaveBeenCalledWith("knowledge-brand", "djl_brand_memory", {
      action: "save",
      version: 4,
      profile: { ...defaultBrand, name: "After" },
    });
    await screen.unmount();
  });
  it("shows sign-in failures as real errors instead of empty library success", async () => {
    api.agent.mockRejectedValue(new Error("Sign in to DJL to use your saved social workspace."));
    const screen = await render(wrapper(<MediaLibraryPanel threadId="knowledge-error" />));
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Sign in to DJL");
    await screen.unmount();
  });
});

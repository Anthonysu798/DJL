import "../index.css";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SOCIAL_PLUGIN, SOCIAL_SKILLS, SOCIAL_PLUGIN_MENTION, mcpMention } from "@djl/contracts";
import { PluginLibrarySurface } from "./PluginLibrary";

const social = { plugin: SOCIAL_PLUGIN, marketplacePath: "builtin://djl", marketplaceName: "DJL" };
const remote = {
  plugin: {
    ...SOCIAL_PLUGIN,
    id: "calendar",
    name: "calendar",
    installed: false,
    enabled: false,
    installPolicy: "AVAILABLE" as const,
    interface: { displayName: "Calendar", shortDescription: "Manage events" },
  },
  marketplaceName: "Personal",
  marketplacePath: "/plugins",
};
function Harness() {
  const [selected, setSelected] = useState<typeof social | null>(null);
  return (
    <div className="dark flex h-[780px] bg-background text-foreground">
      <PluginLibrarySurface
        entries={[social, remote]}
        skills={SOCIAL_SKILLS}
        servers={[
          {
            name: "DJL Work Tools",
            plugin: SOCIAL_PLUGIN,
            mention: mcpMention("DJL Work Tools", SOCIAL_PLUGIN_MENTION),
          },
        ]}
        selected={selected}
        onSelect={setSelected}
        onRefresh={vi.fn()}
      />
    </div>
  );
}

describe("Desktop plugin library", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  it("opens social plugin details and explains bundled publishing skills", async () => {
    const screen = await render(<Harness />);
    await page.getByRole("button", { name: /Social Media Create, review/ }).click();
    await expect
      .element(page.getByRole("heading", { name: "Social Media", exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("DJL Work Tools", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /social-publish/ }).click();
    await expect
      .element(page.getByText(/Require explicit confirmation of this content version/))
      .toBeVisible();
    await screen.unmount();
  });
  it("searches discovered plugins, filters installed plugins, and browses MCPs", async () => {
    const screen = await render(<Harness />);
    await page
      .getByRole("textbox", { name: "Search plugins, MCP servers, or skills" })
      .fill("Calendar");
    await expect
      .element(page.getByRole("button", { name: "Calendar Manage events" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Installed", exact: true }).click();
    await expect.element(page.getByText("No matches. Try another search.")).toBeVisible();
    await page.getByRole("button", { name: "MCP servers", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "DJL Work Tools Social Media · MCP" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await expect.element(page.getByRole("button", { name: /social-create-post/ })).toBeVisible();
    await screen.unmount();
  });
});

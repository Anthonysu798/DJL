import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { createMentionChipIconElement, MentionChipIcon } from "./MentionChipIcon";

const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const plugin = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });
vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    plugins: {
      getSnapshot: async () => ({
        sources: [
          {
            plugins: [
              plugin("word", { iconDomain: "word.cloud.microsoft" }),
              plugin("linear", { websiteUrl: "https://linear.app" }),
              plugin("multipost"),
            ],
          },
        ],
      }),
    },
  }),
}));
vi.mock("~/lib/siteFavicon", async (importActual) => ({
  ...(await importActual<typeof import("~/lib/siteFavicon")>()),
  resolveSiteFaviconUrl: (site: string) => `${LOGO}#${site}`,
  probeSiteFavicon: async () => "ok" as const,
}));

afterEach(async () => {
  await cleanup();
  document.body.replaceChildren();
});

describe("plugin mention chip icon", () => {
  it("repaints the message-box chip with the plugin's logo, in place", async () => {
    const icon = createMentionChipIconElement("word", "plugin");
    document.body.append(icon);
    expect(icon.style.getPropertyValue("mask")).not.toBe("");

    await expect.poll(() => icon.style.background).toContain("#word.cloud.microsoft");
    expect(icon.style.getPropertyValue("mask")).toBe("");
    // Same element, so the editor has nothing to undo.
    expect(document.body.firstElementChild).toBe(icon);
  });

  it("keeps the plugin mark for a plugin without a logo, and file chips as they were", async () => {
    const mark = createMentionChipIconElement("multipost", "plugin");
    const file = createMentionChipIconElement("src/main.ts");
    document.body.append(mark, file);
    const linear = createMentionChipIconElement("linear", "plugin");
    document.body.append(linear);
    await expect.poll(() => linear.style.background).toContain("#https://linear.app");

    expect(mark.style.background).toBe("");
    expect(mark.style.getPropertyValue("mask")).not.toBe("");
    expect(file.style.background).toBe("");
  });

  it("shows the logo on a sent message's chip", async () => {
    const screen = await render(<MentionChipIcon path="word" kind="plugin" theme="dark" />);
    await expect
      .poll(() => screen.container.querySelector("img")?.getAttribute("src"))
      .toBe(`${LOGO}#word.cloud.microsoft`);

    await screen.rerender(<MentionChipIcon path="multipost" kind="plugin" theme="dark" />);
    await expect.poll(() => screen.container.querySelector("img")).toBeNull();
    expect(screen.container.querySelector("svg, [data-slot='central-icon']")).not.toBeNull();
  });
});

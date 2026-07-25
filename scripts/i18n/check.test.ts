import { describe, expect, it } from "vitest";

import {
  canonicalCatalogJson,
  collectVisibleEnglish,
  isProductionSourceFile,
  validateCatalogs,
  validateCurrentWhatsNewCatalog,
  validateLocaleReviewStatus,
  validateRendererCopyKeys,
} from "./check";

describe("i18n visible-copy classifier", () => {
  it.each([
    ["JSX text", `<button>Go forward</button>`],
    ["accessible label", `<button aria-label="Go back" />`],
    ["visible model field", `const item = { description: "Choose a custom model" };`],
    ["conditional copy", `<p>{ok ? "Update complete" : "Update failed"}</p>`],
    ["toast copy", `toast({ title: "Could not save settings" })`],
    ["referenced copy", `const label = "Open settings"; <Button label={label} />`],
    ["suffixed aria label", `const searchAriaLabel = "Search recent chats";`],
    [
      "suffixed unavailable message",
      `const providerUnavailableMessage = "Provider is unavailable";`,
    ],
    ["suffixed fallback title", `const recoveryFallbackTitle = "Try another project";`],
    ["suffixed short label", `const navigationShortLabel = "Recent chats";`],
    ["suffixed option label", `const localOptionLabel = "Use local checkout";`],
    ["suffixed worktree option label", `const worktreeOptionLabel = "Create worktree";`],
    ["suffixed worktree badge label", `const worktreeBadgeLabel = "Worktree ready";`],
    ["literal JSX custom aria-label prop", `<TimeColumn ariaLabel="Hour" />`],
    [
      "runtime event copy rendered by the web UI",
      `emit({ type: "runtime-error", message: "Browser commenting could not be restored." })`,
    ],
  ])("detects %s", (_name, source) => {
    expect(collectVisibleEnglish(source, "fixture.tsx")).not.toEqual([]);
  });

  it.each([
    ["translation key", `<button>{t("actions.back")}</button>`],
    ["provider name", `<span>OpenCode</span>`],
    ["command", `<code>bun run test</code>`],
    ["path", `<span>/Users/me/project</span>`],
    ["model id", `<span>gpt-5.6-codex</span>`],
    ["raw diagnostic", `throw new Error("Provider disconnected at /tmp/socket")`],
    ["CSS value", `const styles = { label: "text-sm font-medium text-foreground" };`],
    [
      "internal RPC error",
      `throw new WsTransportRpcError({ message: "Unknown RPC method: nope" });`,
    ],
  ])("excludes %s", (_name, source) => {
    expect(collectVisibleEnglish(source, "fixture.tsx")).toEqual([]);
  });
});

describe("i18n catalog validation", () => {
  it("checks shape, value type, interpolation, and plural parity", () => {
    const errors = validateCatalogs({
      en: { common: { count_one: "{{count}} item", count_other: "{{count}} items" } },
      fr: { common: { count_one: "élément", count_many: "{{total}} éléments" } },
    });
    expect(errors.join("\n")).toMatch(/missing key|extra key|placeholder|plural/i);
  });

  it("produces a stable recursively sorted catalog representation", () => {
    expect(canonicalCatalogJson({ z: { b: "b", a: "a" }, a: "a" })).toBe(
      '{\n  "a": "a",\n  "z": {\n    "a": "a",\n    "b": "b"\n  }\n}\n',
    );
  });

  it("requires English approval and a valid explicit review status for every locale", () => {
    expect(validateLocaleReviewStatus(["en", "fr"], { en: "approved", fr: "draft" })).toEqual([]);
    expect(
      validateLocaleReviewStatus(["en", "zh-Hans", "fr"], {
        en: "approved",
        "zh-Hans": "approved",
        fr: "draft",
      }),
    ).toEqual([]);
    expect(validateLocaleReviewStatus(["en", "fr"], { en: "approved", fr: "approved" })).toEqual(
      [],
    );
    expect(validateLocaleReviewStatus(["en", "fr"], { en: "draft" })).not.toEqual([]);
    expect(validateLocaleReviewStatus(["en", "fr"], { en: "approved", fr: "pending" })).not.toEqual(
      [],
    );
  });

  it("requires catalog keys for every authored field in the current release entry", () => {
    const source = `
      export const WHATS_NEW_ENTRIES = [{
        version: "1.2.3",
        features: [{ id: "faster", title: "Faster", description: "Much faster now", details: "Technical detail" }],
      }] as const;
    `;
    expect(
      validateCurrentWhatsNewCatalog(source, "1.2.3", {
        whatsNew: {
          currentRelease: {
            features: {
              faster: {
                title: "Faster",
                description: "Much faster now",
                details: "Technical detail",
              },
            },
          },
        },
      }),
    ).toEqual([]);
    expect(validateCurrentWhatsNewCatalog(source, "1.2.3", {})).toHaveLength(3);
    expect(validateCurrentWhatsNewCatalog(source, "2.0.0", {})).toEqual([
      "whatsNew/entries.ts: no entry matches current app version 2.0.0",
    ]);
  });

  it("validates literal renderer keys with namespaces and i18next plural resolution", () => {
    const catalog = {
      shell: { sidebar: { status: { working: "Working" } } },
      work: { items_one: "{{count}} item", items_other: "{{count}} items" },
    };
    expect(
      validateRendererCopyKeys(
        `translateRendererCopy("shell:sidebar.status.working", "Working");\ntranslateRendererCopy("work:items", "Items");`,
        catalog,
      ),
    ).toEqual([]);
    expect(
      validateRendererCopyKeys(
        `translateRendererCopy("shell:sidebar.status.missing", "Missing");\ntranslateRendererCopy("items", "Items");`,
        catalog,
      ).join("\n"),
    ).toMatch(/missing renderer catalog key[\s\S]*must include a namespace/);
  });
});

describe("i18n production source selection", () => {
  it("excludes only the explicit development preview modules", () => {
    expect(isProductionSourceFile("/repo/apps/web/src/components/DebugFeatureFlagsMenu.tsx")).toBe(
      false,
    );
    expect(
      isProductionSourceFile("/repo/apps/web/src/components/useGitProgressToastPreview.ts"),
    ).toBe(false);
    expect(isProductionSourceFile("/repo/apps/web/src/featureFlags.ts")).toBe(true);
    expect(isProductionSourceFile("/repo/apps/web/src/components/PluginLibrary.tsx")).toBe(true);
    expect(isProductionSourceFile("/repo/apps/web/src/components/ui/toast.tsx")).toBe(true);
  });
});

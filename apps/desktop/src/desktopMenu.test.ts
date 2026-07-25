import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createDesktopI18n } from "./desktopI18n";
import { buildDesktopMenuTemplate, rebuildDesktopMenu } from "./desktopMenu";

function labels(items: readonly MenuItemConstructorOptions[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (item.label) result.push(item.label);
    if (Array.isArray(item.submenu)) result.push(...labels(item.submenu));
  }
  return result;
}

describe("desktop menu localization", () => {
  it("localizes top-level and explicit role labels without changing actions", async () => {
    const runtime = await createDesktopI18n("fr", []);
    const dispatch = vi.fn();
    const template = buildDesktopMenuTemplate({
      platform: "win32",
      appName: "DJL",
      t: runtime.t,
      dispatch,
      checkForUpdates: vi.fn(),
      resetZoom: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
    });
    const allLabels = labels(template);

    expect(allLabels).toEqual(
      expect.arrayContaining([
        "Fichier",
        "Édition",
        "Affichage",
        "Fenêtre",
        "Aide",
        "Paramètres…",
        "Annuler",
        "Rétablir",
        "Recharger",
        "Plein écran",
      ]),
    );
    const settings = (template[0]!.submenu as MenuItemConstructorOptions[]).find(
      (item) => item.label === "Paramètres…",
    );
    settings?.click?.({} as never, {} as never, {} as never);
    expect(dispatch).toHaveBeenCalledWith("open-settings");
  });

  it("rebuilds and installs the menu immediately", async () => {
    const runtime = await createDesktopI18n("en", []);
    const build = vi.fn(() => ({ id: "menu" }));
    const set = vi.fn();
    rebuildDesktopMenu({
      template: buildDesktopMenuTemplate({
        platform: "darwin",
        appName: "DJL",
        t: runtime.t,
        dispatch: vi.fn(),
        checkForUpdates: vi.fn(),
        resetZoom: vi.fn(),
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
      }),
      build: build as never,
      set: set as never,
    });
    expect(build).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ id: "menu" });
  });

  it("preserves Electron's macOS windowMenu role with localized explicit items", async () => {
    const runtime = await createDesktopI18n("ja", []);
    const template = buildDesktopMenuTemplate({
      platform: "darwin",
      appName: "DJL",
      t: runtime.t,
      dispatch: vi.fn(),
      checkForUpdates: vi.fn(),
      resetZoom: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
    });
    const windowMenu = template.find((item) => item.role === "windowMenu");

    expect(windowMenu?.label).toBe("ウインドウ");
    expect(labels(windowMenu?.submenu as MenuItemConstructorOptions[])).toEqual(
      expect.arrayContaining(["しまう", "拡大／縮小", "すべてを手前に移動"]),
    );
  });
});

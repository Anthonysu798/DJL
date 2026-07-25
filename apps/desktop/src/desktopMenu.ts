import type { Menu, MenuItemConstructorOptions } from "electron";
import type { DesktopTranslate } from "./desktopI18n";
import {
  resolveDesktopMenuAccelerator,
  resolveKeyboardShortcutsMenuAccelerator,
  shouldUseNativeZoomMenuRoles,
} from "./menuShortcuts";

export interface DesktopMenuOptions {
  readonly platform: NodeJS.Platform;
  readonly appName: string;
  readonly t: DesktopTranslate;
  readonly dispatch: (action: string) => void;
  readonly checkForUpdates: () => void;
  readonly resetZoom: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
}

const separator = (): MenuItemConstructorOptions => ({ type: "separator" });

export function buildDesktopMenuTemplate(
  options: DesktopMenuOptions,
): MenuItemConstructorOptions[] {
  const { platform, appName, t } = options;
  const acceleratorProps = (
    accelerator: MenuItemConstructorOptions["accelerator"],
  ): Pick<MenuItemConstructorOptions, "accelerator"> => {
    const resolved = resolveDesktopMenuAccelerator(platform, accelerator);
    return resolved ? { accelerator: resolved } : {};
  };
  const keyboardShortcutsAccelerator = resolveKeyboardShortcutsMenuAccelerator(platform);
  const zoomItems: MenuItemConstructorOptions[] = shouldUseNativeZoomMenuRoles(platform)
    ? [
        { role: "resetZoom", label: t("menu.resetZoom") },
        {
          role: "zoomIn",
          label: t("menu.zoomIn"),
          ...acceleratorProps("CmdOrCtrl+="),
        },
        {
          role: "zoomIn",
          label: t("menu.zoomIn"),
          ...acceleratorProps("CmdOrCtrl+Plus"),
          visible: false,
        },
        { role: "zoomOut", label: t("menu.zoomOut") },
      ]
    : [
        { label: t("menu.resetZoom"), click: options.resetZoom },
        { label: t("menu.zoomIn"), click: options.zoomIn },
        { label: t("menu.zoomOut"), click: options.zoomOut },
      ];

  const template: MenuItemConstructorOptions[] = [];
  if (platform === "darwin") {
    template.push({
      label: t("menu.app", { appName }),
      submenu: [
        { role: "about", label: t("menu.about", { appName }) },
        { label: t("menu.checkForUpdates"), click: options.checkForUpdates },
        separator(),
        {
          label: t("menu.settings"),
          accelerator: "CmdOrCtrl+,",
          click: () => options.dispatch("open-settings"),
        },
        separator(),
        { role: "services", label: t("menu.services") },
        separator(),
        { role: "hide", label: t("menu.hide", { appName }) },
        { role: "hideOthers", label: t("menu.hideOthers") },
        { role: "unhide", label: t("menu.unhide") },
        separator(),
        { role: "quit", label: t("menu.quit", { appName }) },
      ],
    });
  }

  const editSubmenu: MenuItemConstructorOptions[] = [
    { role: "undo", label: t("menu.undo") },
    { role: "redo", label: t("menu.redo") },
    separator(),
    { role: "cut", label: t("menu.cut") },
    { role: "copy", label: t("menu.copy") },
    { role: "paste", label: t("menu.paste") },
    { role: "pasteAndMatchStyle", label: t("menu.pasteAndMatchStyle") },
    { role: "delete", label: t("menu.delete") },
    { role: "selectAll", label: t("menu.selectAll") },
  ];
  if (platform === "darwin") {
    editSubmenu.push(separator(), {
      label: t("menu.speech"),
      submenu: [
        { role: "startSpeaking", label: t("menu.startSpeaking") },
        { role: "stopSpeaking", label: t("menu.stopSpeaking") },
      ],
    });
  }

  template.push(
    {
      label: t("menu.file"),
      submenu: [
        ...(platform === "darwin"
          ? []
          : [
              {
                label: t("menu.settings"),
                ...acceleratorProps("CmdOrCtrl+,"),
                click: () => options.dispatch("open-settings"),
              },
              separator(),
            ]),
        {
          role: platform === "darwin" ? "close" : "quit",
          label: platform === "darwin" ? t("menu.close") : t("menu.quit", { appName }),
        },
      ],
    },
    { label: t("menu.edit"), submenu: editSubmenu },
    {
      label: t("menu.view"),
      submenu: [
        {
          label: t("menu.newTerminalTab"),
          ...acceleratorProps("CmdOrCtrl+T"),
          click: () => options.dispatch("new-terminal-tab"),
        },
        separator(),
        {
          label: t("menu.toggleSidebar"),
          ...acceleratorProps("CmdOrCtrl+B"),
          click: () => options.dispatch("toggle-sidebar"),
        },
        {
          label: t("menu.toggleBrowser"),
          ...acceleratorProps("CmdOrCtrl+Shift+B"),
          click: () => options.dispatch("toggle-browser"),
        },
        separator(),
        { role: "reload", label: t("menu.reload") },
        { role: "forceReload", label: t("menu.forceReload") },
        { role: "toggleDevTools", label: t("menu.toggleDevTools") },
        separator(),
        ...zoomItems,
        separator(),
        { role: "togglefullscreen", label: t("menu.fullscreen") },
      ],
    },
    {
      label: t("menu.window"),
      role: "windowMenu",
      submenu: [
        { role: "minimize", label: t("menu.minimize") },
        ...(platform === "darwin"
          ? [
              { role: "zoom", label: t("menu.zoom") } as MenuItemConstructorOptions,
              separator(),
              { role: "front", label: t("menu.front") } as MenuItemConstructorOptions,
            ]
          : [{ role: "close", label: t("menu.close") } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: t("menu.help"),
      role: "help",
      submenu: [
        {
          label: t("menu.keyboardShortcuts"),
          ...(keyboardShortcutsAccelerator ? { accelerator: keyboardShortcutsAccelerator } : {}),
          click: () => options.dispatch("show-shortcuts"),
        },
        separator(),
        { label: t("menu.checkForUpdates"), click: options.checkForUpdates },
      ],
    },
  );
  return template;
}

export function rebuildDesktopMenu(options: {
  readonly template: MenuItemConstructorOptions[];
  readonly build: (template: MenuItemConstructorOptions[]) => Menu;
  readonly set: (menu: Menu) => void;
}): void {
  options.set(options.build(options.template));
}

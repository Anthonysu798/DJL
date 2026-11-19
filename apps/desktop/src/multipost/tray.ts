import { app, Menu, Tray, nativeImage, type BrowserWindow } from "electron";
import { desktopT } from "../desktopI18n";
export class MultiPostTray {
  private tray: Tray;
  constructor(
    iconPath: string | null,
    private readonly reveal: () => void,
  ) {
    const image = iconPath
      ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
      : nativeImage.createEmpty();
    this.tray = new Tray(image);
    this.tray.setToolTip("DJL MultiPost");
    this.refresh();
    this.tray.on("click", reveal);
  }
  refresh() {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: desktopT("multipost.open"), click: this.reveal },
        { type: "separator" },
        { label: desktopT("multipost.quit"), click: () => app.quit() },
      ]),
    );
  }
  attach(window: BrowserWindow, isQuitting: () => boolean) {
    window.on("close", (event) => {
      if (!isQuitting()) {
        event.preventDefault();
        window.hide();
      }
    });
  }
  dispose() {
    this.tray.destroy();
  }
}

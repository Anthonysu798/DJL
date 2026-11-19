import { app, BrowserWindow, ipcMain } from "electron";
import { writeFileSync } from "node:fs";
import {
  ComputerStopPresentation,
  computerStopWindowOptions,
} from "../src/computerStopPresentation";

const [preload, output] = process.argv.slice(2);
if (!preload || !output) throw new Error("The fixture needs preload and report paths.");
const report: Record<string, unknown> = { surface: "native-stop-window-lifecycle" };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const drained = async () => {
  const deadline = Date.now() + 2000;
  while (BrowserWindow.getAllWindows().length > 0 && Date.now() < deadline) await wait(20);
  return BrowserWindow.getAllWindows().length;
};
app.setActivationPolicy("accessory");
// Keep this standalone host alive between its three safety-window cycles.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const presentation = new ComputerStopPresentation({
    ipc: ipcMain,
    createWindow: () =>
      new BrowserWindow(
        computerStopWindowOptions({ x: 0, y: 0, width: 1024, height: 768 }, preload),
      ),
    copy: () => ({
      title: "DJL lifecycle fixture",
      stop: "Stop",
      stopping: "Stopping",
      failure: "Not confirmed",
    }),
    stop: async () => {
      report.stopAcknowledged = true;
    },
    onError: () => {
      report.presentationError = true;
    },
  });
  try {
    const task = { threadId: "owned-native-window-fixture", turnId: "first" };
    await presentation.taskStarted(task);
    report.firstWindowCount = BrowserWindow.getAllWindows().length;
    presentation.taskEnded(task);
    report.windowsAfterTaskEnd = await drained();
    await presentation.taskStarted({ ...task, turnId: "second" });
    report.secondWindowCount = BrowserWindow.getAllWindows().length;
    await presentation.requestStop();
    report.windowsAfterStop = await drained();
    await presentation.taskStarted({ ...task, turnId: "shutdown" });
    report.thirdWindowCount = BrowserWindow.getAllWindows().length;
    presentation.dispose();
    report.windowsAfterDispose = await drained();
    report.passed =
      report.firstWindowCount === 1 &&
      report.windowsAfterTaskEnd === 0 &&
      report.secondWindowCount === 1 &&
      report.windowsAfterStop === 0 &&
      report.thirdWindowCount === 1 &&
      report.windowsAfterDispose === 0 &&
      report.stopAcknowledged === true &&
      !report.presentationError;
  } catch (error) {
    report.passed = false;
    report.failure = error instanceof Error ? error.message : "Native fixture failed";
  } finally {
    writeFileSync(output, JSON.stringify(report), { mode: 0o600 });
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.exit(report.passed ? 0 : 1);
  }
});

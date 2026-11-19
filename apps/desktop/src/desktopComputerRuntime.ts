import type { ComputerStopPresentation } from "./computerStopPresentation";
import type { CuaComputerTask } from "@synara/shared/cuaDriverProtocol";
/** DJL's desktop wiring for the pinned Synara Cua engine. No driver starts on boot. */
import { join } from "node:path";
import { CuaDriverHost, sweepOrphanedCuaDrivers } from "./cuaDriverHost";
import { DesktopAppSnapManager } from "./appSnapManager";
import { ComputerFrameTap, type ComputerPreviewFrame } from "./computerFrameTap";
import { ComputerShield } from "./computerShield";
import { EscapeKillSwitchMonitor } from "./escapeKillSwitchMonitor";
import { registerComputerDesktopLifecycle } from "./computerDesktopLifecycle";
import {
  readAgentCursorPreference,
  writeAgentCursorPreference,
  normalizeAgentCursorStylePreference,
} from "./agentCursorPreference";
import { COMPUTER_PERMISSION_KINDS } from "@synara/shared/computerGrants";
import type { DesktopAppSnapManagerOptions } from "./appSnapManager";

export interface DesktopComputerRuntimeOptions {
  readonly binaryPath: string;
  readonly helperPath: string;
  readonly bundleId: string;
  readonly capability: string;
  readonly authorizeCall?: (name: string, args: unknown, deliveryMode?: unknown) => boolean;
  readonly onActionActivity?: (active: boolean) => void;
  readonly stateDirectory: string;
  readonly presentation: ComputerStopPresentation;
  readonly stopProviderThread: (threadId: string) => Promise<void>;
  readonly appSnap: Omit<
    DesktopAppSnapManagerOptions,
    "helperPath" | "captureDirectory" | "excludedBundleId" | "platform"
  >;
  readonly ownPids: () => ReadonlySet<number>;
  readonly powerMonitor: Parameters<typeof registerComputerDesktopLifecycle>[0];
  readonly sendFrame: (channel: string, frame: ComputerPreviewFrame) => void;
  readonly onEmergencyStop: () => void;
  readonly onError: (error: unknown) => void;
}

export class DesktopComputerRuntime {
  readonly appSnap: DesktopAppSnapManager;
  private readonly host: CuaDriverHost;
  private readonly frameTap: ComputerFrameTap;
  private readonly monitor: EscapeKillSwitchMonitor;
  private readonly disposeLifecycle: () => void;
  private readonly cursorPreferencePath: string;

  constructor(private readonly options: DesktopComputerRuntimeOptions) {
    this.cursorPreferencePath = join(options.stateDirectory, "agent-cursor.json");
    this.appSnap = new DesktopAppSnapManager({
      ...options.appSnap,
      platform: process.platform,
      helperPath: options.helperPath,
      captureDirectory: join(options.stateDirectory, "appsnap", "tmp"),
      excludedBundleId: options.bundleId,
    });
    this.frameTap = new ComputerFrameTap({
      helperPath: options.helperPath,
      send: options.sendFrame,
      onError: options.onError,
    });
    this.host = new CuaDriverHost({
      binaryPath: options.binaryPath,
      onTaskBegin: (task) => options.presentation.taskStarted(task),
      onTaskEnd: (task) => options.presentation.taskEnded(task),
      ...(options.onActionActivity ? { onActionActivity: options.onActionActivity } : {}),
      bundleId: options.bundleId,
      capability: options.capability,
      ...(options.authorizeCall ? { authorizeCall: options.authorizeCall } : {}),
      ownPids: options.ownPids,
      cursorStyle: () => readAgentCursorPreference(this.cursorPreferencePath),
      frameTap: this.frameTap,
      shield: new ComputerShield({ helperPath: options.helperPath, onError: options.onError }),
      inputMonitorState: () =>
        this.monitor?.state ?? { ready: false, error: "input_monitor_starting" },
      onInputMonitorArmedChange: (armed) => this.monitor?.setArmed(armed),
      activateInputMonitor: async () => {
        await this.monitor.activate();
      },
      checkPermissions: async (request) => {
        const state = await this.appSnap.refreshState(COMPUTER_PERMISSION_KINDS, {
          force: request?.force === true,
        });
        if (
          state.status === "error" &&
          [
            state.accessibilityPermission,
            state.inputMonitoringPermission,
            state.screenRecordingPermission,
          ].includes("unknown")
        ) {
          throw new Error(state.message ?? "The native helper could not verify macOS permissions.");
        }
        if (
          this.host.isInputMonitorRequested &&
          state.inputMonitoringPermission === "granted" &&
          this.monitor.state.error === "input-monitoring-required"
        )
          await this.monitor.activate(true);
        return {
          accessibility: state.accessibilityPermission === "granted",
          inputMonitoring: state.inputMonitoringPermission === "granted",
          screenRecording: state.screenRecordingPermission === "granted",
        };
      },
      setup: async () => {
        await this.appSnap.startPermissionSetup(COMPUTER_PERMISSION_KINDS);
      },
      releaseHeldInput: async () => {
        await this.appSnap.releaseHeldInput();
      },
    });
    this.monitor = new EscapeKillSwitchMonitor({
      helperPath: options.helperPath,
      onPhysicalInput: (event) => this.host.physicalInput(event),
      onStateChange: (state) => this.host.inputMonitorStateChanged(state),
      onEscape: () => {
        const interrupted = this.host.emergencyStopInput();
        if (options.presentation.activeTasks().length > 0)
          void options.presentation.requestStop().catch(options.onError);
        else if (interrupted) options.onEmergencyStop();
      },
      onError: options.onError,
    });
    this.disposeLifecycle = registerComputerDesktopLifecycle(
      options.powerMonitor,
      this.host,
      options.onError,
    );
  }

  async stopTasks(tasks: readonly CuaComputerTask[]): Promise<void> {
    const nativeStops = tasks.map((task) => this.host.stopTaskByUser(task));
    const providerStops = [...new Set(tasks.map((task) => task.threadId))].map((threadId) =>
      this.options.stopProviderThread(threadId),
    );
    await Promise.all([...nativeStops, ...providerStops]);
  }
  refreshPresentation(): void {
    this.options.presentation.refresh();
  }
  listen(): Promise<string> {
    sweepOrphanedCuaDrivers();
    return this.host.listen();
  }
  setPreviewSubscribed(subscribed: boolean): void {
    this.frameTap.setSubscribed(subscribed);
  }
  async setCursorStyle(rawStyle: unknown): Promise<void> {
    const style = normalizeAgentCursorStylePreference(rawStyle);
    writeAgentCursorPreference(this.cursorPreferencePath, style);
    await this.host.setCursorStyle(style);
  }
  async dispose(): Promise<void> {
    this.disposeLifecycle();
    // The host must acknowledge held-input cleanup before its monitors are retired.
    await this.host.dispose();
    this.options.presentation.dispose();
    this.monitor.dispose();
    this.appSnap.dispose();
  }
}

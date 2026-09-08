// FILE: initialBackendWindowOpen.ts
// Purpose: Starts the renderer alongside the backend in both desktop modes.
// Layer: Desktop startup utility
// Exports: openInitialBackendWindow

export type BackendWindowReadySource = "listening" | "http";

export interface InitialBackendWindowOpenOptions {
  readonly isDevelopment: boolean;
  readonly baseUrl: string;
  readonly hasExistingWindow: () => boolean;
  readonly createWindow: () => void;
  readonly getReadinessInFlight: () => Promise<void> | null;
  readonly setReadinessInFlight: (promise: Promise<void> | null) => void;
  readonly waitForBackendWindowReady: (baseUrl: string) => Promise<BackendWindowReadySource>;
  readonly writeLog: (message: string) => void;
  readonly isReadinessAborted: (error: unknown) => boolean;
  readonly formatErrorMessage: (error: unknown) => string;
  readonly warn: (message: string, error: unknown) => void;
}

export function openInitialBackendWindow(options: InitialBackendWindowOpenOptions): void {
  if (options.baseUrl.length === 0 || options.hasExistingWindow()) {
    return;
  }

  // Both the local-file renderer and the dev server can load independently of
  // the backend. The renderer's WebSocket reconnects when the backend listens.
  options.createWindow();
  options.writeLog("bootstrap main window created");

  if (options.getReadinessInFlight() !== null) {
    return;
  }

  const nextOpen = options
    .waitForBackendWindowReady(options.baseUrl)
    .then((source) => {
      options.writeLog(`bootstrap backend ready source=${source}`);
    })
    .catch((error) => {
      if (options.isReadinessAborted(error)) {
        return;
      }
      options.writeLog(
        `bootstrap backend readiness warning message=${options.formatErrorMessage(error)}`,
      );
      options.warn("[desktop] backend readiness check timed out during bootstrap", error);
    })
    .finally(() => {
      if (options.getReadinessInFlight() === nextOpen) {
        options.setReadinessInFlight(null);
      }
    });

  options.setReadinessInFlight(nextOpen);
}

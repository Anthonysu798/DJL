export const COMPUTER_STOP_CHANNELS = {
  request: "desktop:computer-floating-stop",
  state: "desktop:computer-floating-stop-state",
  ready: "desktop:computer-floating-stop-ready",
} as const;
export interface ComputerStopView {
  readonly title: string;
  readonly stop: string;
  readonly stopping: string;
  readonly failure: string;
  readonly pending: boolean;
  readonly failed: boolean;
}

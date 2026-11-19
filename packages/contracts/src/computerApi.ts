import type {
  ComputerGetStatusInput,
  ComputerStatusResult,
  ComputerProvisionInput,
  ComputerProvisionResult,
  ComputerSetControlEnabledInput,
  ComputerControlEnabledResult,
  ComputerThreadInput,
  ThreadComputerState,
  ComputerGetStateInput,
  ComputerState,
  ComputerInputClickInput,
  ComputerActionResult,
  ComputerInputScrollInput,
  ComputerInputKeyInput,
  ComputerEvent,
} from "./computer";
import type { ComputerGetAuditHistoryInput, ComputerGetAuditHistoryResult } from "./computerAudit";
export interface ComputerApi {
  /** Thread-independent backend status for surfaces outside any conversation. */
  getStatus: (input: ComputerGetStatusInput) => Promise<ComputerStatusResult>;
  getAuditHistory: (input: ComputerGetAuditHistoryInput) => Promise<ComputerGetAuditHistoryResult>;
  provision: (input: ComputerProvisionInput) => Promise<ComputerProvisionResult>;
  setControlEnabled: (
    input: ComputerSetControlEnabledInput,
  ) => Promise<ComputerControlEnabledResult>;
  getThreadState: (input: ComputerThreadInput) => Promise<ThreadComputerState>;
  getState: (input: ComputerGetStateInput) => Promise<ComputerState>;
  /** User input from the computer dock pane; needs no agent turn in flight. */
  inputClick: (input: ComputerInputClickInput) => Promise<ComputerActionResult>;
  inputScroll: (input: ComputerInputScrollInput) => Promise<ComputerActionResult>;
  inputKey: (input: ComputerInputKeyInput) => Promise<ComputerActionResult>;
  onEvent: (callback: (event: ComputerEvent) => void) => () => void;
}

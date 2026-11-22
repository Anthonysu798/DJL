import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { decodeComputerUseRequest, type ComputerUseRequest } from "@djl/contracts";
import type { ComputerUseManager } from "./computerUseManager";
import { COMPUTER_USE_IPC_CHANNELS } from "./computerUseIpcChannels";

export function isTrustedComputerUseUrl(actual: string, entry: string): boolean {
  try {
    const sender = new URL(actual);
    const trusted = new URL(entry);
    return (
      !sender.username &&
      !sender.password &&
      sender.protocol === trusted.protocol &&
      sender.host === trusted.host &&
      sender.pathname === trusted.pathname
    );
  } catch {
    return false;
  }
}

export function registerComputerUseIpcHandlers(
  ipc: Pick<IpcMain, "handle">,
  manager: Pick<ComputerUseManager, "request"> | (() => Pick<ComputerUseManager, "request">),
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipc.handle(COMPUTER_USE_IPC_CHANNELS.request, async (event, input: unknown) => {
    if (!isTrustedSender(event)) throw new Error("Untrusted computer-use caller");
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("Invalid computer-use envelope");
    }
    const envelope = input as Record<string, unknown>;
    if (
      Object.keys(envelope).some((key) => key !== "threadId" && key !== "request") ||
      typeof envelope.threadId !== "string" ||
      !envelope.threadId.trim() ||
      envelope.threadId.length > 128
    ) {
      throw new Error("Invalid computer-use envelope");
    }
    try {
      const service = typeof manager === "function" ? manager() : manager;
      return await service.request(envelope.threadId, envelope.request, { origin: "renderer" });
    } catch {
      let method: ComputerUseRequest["method"] = "status";
      try {
        method = decodeComputerUseRequest(envelope.request).method;
      } catch {
        /* Invalid request remains a status error. */
      }
      return {
        method,
        error: {
          code: "helper-unavailable",
          message: "Native computer use is unavailable on this device",
        },
      };
    }
  });
}

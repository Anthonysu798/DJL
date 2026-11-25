// FILE: agentLinkChild.ts
// Purpose: Isolated Node-mode Electron child that lends one of this computer's agents to
//          another person's group. The link itself lives in @djl/remote-gateway; this entry
//          only reports its status to the main process.

// Names here are prefixed: this file and remoteGatewayChild.ts are both plain scripts.
interface AgentLinkHandle {
  stop(): void;
  leave(): Promise<void>;
}

const linkGateway = require("@djl/remote-gateway") as {
  startGuestAgentLink(options: { onStatus(status: unknown): void }): AgentLinkHandle;
};

function sendToMain(message: unknown): void {
  if (process.connected) process.send?.(message);
}

const agentLink = linkGateway.startGuestAgentLink({
  onStatus: (status) => sendToMain({ type: "status", status }),
});

process.on("message", (rawMessage: unknown) => {
  const type =
    rawMessage && typeof rawMessage === "object"
      ? (rawMessage as Record<string, unknown>).type
      : null;
  if (type !== "leave") return;
  // Leaving forgets the other computer before this process ends.
  void agentLink.leave().finally(() => {
    sendToMain({ type: "left" });
    setTimeout(() => process.exit(0), 100).unref();
  });
});
process.on("SIGTERM", () => {
  agentLink.stop();
  process.exit(0);
});

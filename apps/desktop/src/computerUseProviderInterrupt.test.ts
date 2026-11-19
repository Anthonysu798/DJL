import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { interruptComputerUseProvider } from "./computerUseProviderInterrupt";

const { WebSocketServer } = createRequire(import.meta.url)("ws") as {
  WebSocketServer: new (options: { port: number; host: string }) => {
    on: (event: string, callback: (...args: any[]) => void) => void;
    address: () => { port: number };
    clients: Set<{ terminate: () => void }>;
    close: (callback: () => void) => void;
  };
};

describe("floating Stop provider interruption", () => {
  it("sends authenticated Effect RPC without needing a renderer", async () => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.on("listening", resolve));
    let request: Record<string, unknown> | undefined;
    server.on("connection", (socket, incoming) => {
      expect(incoming.url).toBe("/ws?token=fixture-token");
      socket.on("message", (data: Buffer) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
        if (message._tag !== "Request") return;
        request = message;
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: message.id,
            exit: { _tag: "Success", value: { sequence: 1 } },
          }),
        );
      });
    });
    try {
      await interruptComputerUseProvider(
        `ws://127.0.0.1:${server.address().port}/?token=fixture-token`,
        "owner-thread",
      );
      expect(request).toMatchObject({
        tag: "orchestration.dispatchCommand",
        payload: { type: "thread.turn.interrupt", threadId: "owner-thread" },
      });
    } finally {
      server.clients.forEach((client) => client.terminate());
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  it("rejects remote endpoints before connecting", async () => {
    await expect(interruptComputerUseProvider("wss://example.com/ws", "thread")).rejects.toThrow(
      "Invalid local",
    );
  });
});

import { randomUUID } from "node:crypto";
import {
  CommandId,
  ThreadId,
  ORCHESTRATION_WS_METHODS,
  COMPUTER_WS_METHODS,
  WsRpcGroup,
} from "@djl/contracts";
import { Effect, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

/** Floating Stop must interrupt the owner even when no chat renderer is open. */
export async function interruptComputerUseProvider(
  rawUrl: string,
  threadId: string,
  options: { readonly revokeComputerControl?: boolean } = {},
): Promise<void> {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "ws:" ||
    url.hostname !== "127.0.0.1" ||
    !threadId.trim() ||
    threadId.length > 128
  )
    throw new Error("Invalid local computer-use interrupt");
  url.pathname = "/ws";
  const socket = Socket.layerWebSocket(url.toString()).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  );
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Layer.mergeAll(socket, RpcSerialization.layerJson)),
  );
  const send = Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WsRpcGroup);
      if (options.revokeComputerControl)
        yield* client[COMPUTER_WS_METHODS.setControlEnabled]({
          threadId: ThreadId.makeUnsafe(threadId),
          enabled: false,
        });
      yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
        type: "thread.turn.interrupt",
        commandId: CommandId.makeUnsafe(randomUUID()),
        threadId: ThreadId.makeUnsafe(threadId),
        createdAt: new Date().toISOString(),
      });
    }),
  ).pipe(
    Effect.provide(protocol),
    Effect.timeout(options.revokeComputerControl ? "10 seconds" : "3 seconds"),
  );
  await Effect.runPromise(send);
}

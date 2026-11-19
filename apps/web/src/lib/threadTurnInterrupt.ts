import { CommandId, type ThreadId } from "@synara/contracts";
import { ensureNativeApi } from "../nativeApi";

/** Revoke native authority before asking a possibly slow provider to finish. */
export async function interruptThreadTurn(threadId: ThreadId): Promise<void> {
  const api = ensureNativeApi();
  await api.computer.setControlEnabled({ threadId, enabled: false });
  await api.orchestration.dispatchCommand({
    type: "thread.turn.interrupt",
    commandId: CommandId.makeUnsafe(crypto.randomUUID()),
    threadId,
    createdAt: new Date().toISOString(),
  });
}

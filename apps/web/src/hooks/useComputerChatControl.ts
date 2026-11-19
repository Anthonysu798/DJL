import { Schema } from "effect";
import { useMutation } from "@tanstack/react-query";
import type { ThreadId } from "@synara/contracts";
import { ensureNativeApi } from "~/nativeApi";
import { useComputerStateStore } from "../computerStateStore";
import { useLocalStorage } from "./useLocalStorage";

const ChatComputerOverrides = Schema.Record(Schema.String, Schema.Boolean);
export async function changeComputerChatControl(
  threadId: ThreadId,
  enabled: boolean,
  commit: (enabled: boolean) => void,
): Promise<void> {
  await ensureNativeApi().computer.setControlEnabled({ threadId, enabled });
  commit(enabled);
}
/** A chat override never enables another chat or resumes a cancelled turn. */
export function useComputerChatControl(threadId: ThreadId, defaultEnabled: boolean) {
  const [overrides, setOverrides] = useLocalStorage<
    Record<string, boolean>,
    Record<string, boolean>
  >("djl:computer-control-by-thread:v1", {}, ChatComputerOverrides);
  const change = useMutation({
    mutationFn: async (input: { threadId: ThreadId; enabled: boolean }) => {
      await changeComputerChatControl(input.threadId, input.enabled, (enabled) =>
        setOverrides((previous) => ({ ...previous, [input.threadId]: enabled })),
      );
    },
  });
  const current = change.variables?.threadId === threadId;
  const pending = current && change.isPending;
  const controlRevoked = useComputerStateStore(
    (state) => state.threadStatesByThreadId[threadId]?.controlEnabled === false,
  );
  const enabled =
    controlRevoked || (pending && change.variables?.enabled === false)
      ? false
      : Object.hasOwn(overrides, threadId)
        ? overrides[threadId]!
        : defaultEnabled;
  return {
    enabled,
    pending,
    error: current ? change.error : null,
    setEnabled: (next: boolean) => {
      if (!pending) change.mutate({ threadId, enabled: next });
    },
  };
}

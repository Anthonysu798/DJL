import type { RelayRole } from "./policy";

type MarkRegistryOffline = () => Promise<void>;

/**
 * Finalizes relay bookkeeping after the runtime has already closed a socket.
 * Deliberately accepts no socket so a close callback cannot close it twice.
 */
export async function finalizeRelaySocketClose(
  role: RelayRole | undefined,
  markRegistryOffline: MarkRegistryOffline,
): Promise<void> {
  if (role === "mac") await markRegistryOffline();
}

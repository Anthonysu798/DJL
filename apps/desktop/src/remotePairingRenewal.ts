import type { DesktopRemoteGatewayState } from "@synara/contracts";

// Owned by main, so closing Settings never leaves the next visitor with an old code.
export function createRemotePairingRenewal(
  refresh: () => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: DesktopRemoteGatewayState | null = null;
  let generation = 0;
  const eligible = () =>
    state?.enabled &&
    state.configured &&
    state.status === "ready" &&
    !state.phoneFingerprint &&
    state.pairingExpiresAt != null;
  function stop() {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    state = null;
  }
  function arm(delay: number) {
    const version = generation;
    timer = setTimeout(async () => {
      timer = undefined;
      if (!eligible() || version !== generation) return;
      try {
        await refresh();
      } catch (error) {
        onError(error);
      }
      // A native state update normally schedules the new code. Retry only if
      // refreshing produced no update, and never spin on an expired timestamp.
      if (version === generation && eligible()) arm(10000);
    }, delay);
    timer.unref?.();
  }
  return {
    update(next: DesktopRemoteGatewayState) {
      stop();
      state = next;
      if (eligible()) arm(Math.max(0, next.pairingExpiresAt! - Date.now() - 30000));
    },
    stop,
  };
}

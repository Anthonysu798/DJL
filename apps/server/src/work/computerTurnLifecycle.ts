import { desktopComputerCredentials } from "./desktopComputerCredentials";

const activityHistoryAuthorizations = new Set<string>();
const pendingTurns = new Map<string, symbol>();

export function isComputerActivityHistoryAuthorized(threadId: string): boolean {
  return activityHistoryAuthorizations.has(threadId);
}

/** Only a real user-turn dispatch may re-enable a thread after Stop. */
export async function beginComputerUseTurn(
  threadId: string,
  options: { readonly allowActivityHistory: boolean },
): Promise<boolean> {
  // Revoke before the first await: a failed or late bridge response cannot retain
  // authorization from the previous turn or override a newer turn's decision.
  activityHistoryAuthorizations.delete(threadId);
  const turn = Symbol();
  pendingTurns.set(threadId, turn);
  try {
    const { url, token } = desktopComputerCredentials;
    if (!url || !token) return false;
    const endpoint = new URL(url);
    if (
      endpoint.protocol !== "http:" ||
      endpoint.hostname !== "127.0.0.1" ||
      endpoint.pathname !== "/computer-use" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      return false;
    endpoint.pathname += "/turn-start";
    const result = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        threadId,
        allowActivityHistory: options.allowActivityHistory === true,
      }),
      signal: AbortSignal.timeout(2_000),
      redirect: "error",
    });
    const resumed = result.ok && ((await result.json()) as { resumed?: unknown }).resumed === true;
    if (resumed && options.allowActivityHistory === true && pendingTurns.get(threadId) === turn) {
      activityHistoryAuthorizations.add(threadId);
    }
    return resumed;
  } catch {
    return false;
  } finally {
    if (pendingTurns.get(threadId) === turn) pendingTurns.delete(threadId);
  }
}

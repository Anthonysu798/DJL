// FILE: driverEnv.ts
// Purpose: Tags a native harness process environment with the DJL thread that owns it.
// Layer: Native harness bridges

/** Adds DJL_THREAD_ID so helpers the agent runs (djl-ssh) can attribute work to the thread. */
export function withDjlThreadId(
  env: NodeJS.ProcessEnv,
  threadId: string | undefined,
): NodeJS.ProcessEnv {
  if (!threadId) return { ...env };
  return { ...env, DJL_THREAD_ID: threadId };
}

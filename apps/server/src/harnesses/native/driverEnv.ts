// FILE: driverEnv.ts
// Purpose: Tags a native harness process environment with the DJL thread that owns it.
// Layer: Native harness bridges

/** Adds DJL_THREAD_ID so helpers the agent runs (djl-ssh) can attribute work to the thread. */
export function withDjlThreadId(
  env: NodeJS.ProcessEnv,
  threadId: string | undefined,
): NodeJS.ProcessEnv {
  const scoped = { ...env };
  delete scoped.DJL_COMPUTER_USE_BRIDGE_TOKEN;
  delete scoped.DJL_COMPUTER_USE_BRIDGE_URL;
  delete scoped.DJL_CUA_HOST_SOCKET;
  delete scoped.DJL_BROWSER_HOST_CAPABILITY;
  delete scoped.DJL_BROWSER_HOST_CAPABILITY_FD;
  delete scoped.DJL_AUTH_TOKEN;
  delete scoped.DJL_MULTIPOST_HOST_URL;
  delete scoped.DJL_MULTIPOST_HOST_TOKEN;

  return threadId ? { ...scoped, DJL_THREAD_ID: threadId } : scoped;
}

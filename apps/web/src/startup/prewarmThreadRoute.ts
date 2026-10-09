// FILE: prewarmThreadRoute.ts
// Purpose: Loads the code-split thread route while the backend is still booting.
// Layer: Renderer startup

const THREAD_ROUTE_ID = "/_chat/$threadId";

interface ChunkLoadingRouter {
  routesById: object;
  loadRouteChunk: (route: never) => Promise<void> | void;
}

/** Every home/work start ends on the thread route, so its chunk is on the critical path. */
export function prewarmThreadRoute(router: ChunkLoadingRouter): void {
  const route = (router.routesById as Record<string, unknown>)[THREAD_ROUTE_ID];
  if (!route) return;
  try {
    void Promise.resolve(router.loadRouteChunk(route as never)).catch(() => undefined);
  } catch {
    // Best effort: navigation loads the chunk on demand if this fails.
  }
}

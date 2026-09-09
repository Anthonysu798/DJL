// FILE: serversReactQuery.ts
// Purpose: React Query options for the Servers registry shared by the composer picker and settings.
// Layer: Web data helper

import type { ServerId, ServerListCommandsResult, ServerListResult } from "@synara/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

/** Same key the Servers settings panel uses so both surfaces share one cache entry. */
export const SERVERS_QUERY_KEY = ["servers"] as const;

export const serverCommandsQueryKey = (id: ServerId) => ["servers", "commands", id] as const;

export function serversQueryOptions() {
  return queryOptions<ServerListResult>({
    queryKey: SERVERS_QUERY_KEY,
    queryFn: () => ensureNativeApi().servers.list(),
    staleTime: 30_000,
  });
}

export function serverCommandsQueryOptions(id: ServerId, limit = 5) {
  return queryOptions<ServerListCommandsResult>({
    queryKey: serverCommandsQueryKey(id),
    queryFn: () => ensureNativeApi().servers.listCommands({ id, limit }),
    staleTime: 5_000,
  });
}

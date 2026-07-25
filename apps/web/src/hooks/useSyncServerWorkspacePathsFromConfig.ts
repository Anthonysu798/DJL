// FILE: useSyncServerWorkspacePathsFromConfig.ts
// Purpose: Rehydrates non-persisted workspace roots from authoritative server config.
// Layer: Web state synchronization

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { useWorkspaceStore } from "../workspaceStore";

export function useSyncServerWorkspacePathsFromConfig(): void {
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const setServerWorkspacePaths = useWorkspaceStore((state) => state.setServerWorkspacePaths);

  useEffect(() => {
    const config = serverConfigQuery.data;
    if (!config) {
      return;
    }
    setServerWorkspacePaths({
      homeDir: config.homeDir,
      chatWorkspaceRoot: config.chatWorkspaceRoot,
      studioWorkspaceRoot: config.studioWorkspaceRoot,
    });
  }, [
    serverConfigQuery.data?.chatWorkspaceRoot,
    serverConfigQuery.data?.homeDir,
    serverConfigQuery.data?.studioWorkspaceRoot,
    setServerWorkspacePaths,
  ]);
}

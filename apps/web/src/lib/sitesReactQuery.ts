// FILE: sitesReactQuery.ts
// Purpose: React Query access to slcor.site publishing: a chat project's linked site, name
//          checks, the account's sites, and publish / unpublish.
// Layer: Web data helper

import type { SitesPublishInput, SitesPublishResult, ThreadId } from "@djl/contracts";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const SITES_QUERY_KEY = ["sites"] as const;

export function siteProjectStatusQueryOptions(threadId: ThreadId) {
  return queryOptions({
    queryKey: [...SITES_QUERY_KEY, "project", threadId],
    queryFn: () => ensureNativeApi().sites.projectStatus({ threadId }),
    staleTime: 10_000,
  });
}

export function siteNameQueryOptions(name: string) {
  return queryOptions({
    queryKey: [...SITES_QUERY_KEY, "name", name],
    queryFn: () => ensureNativeApi().sites.nameAvailable({ name }),
    enabled: name.length >= 3,
    staleTime: 15_000,
    retry: false,
  });
}

export function sitesListQueryOptions() {
  return queryOptions({
    queryKey: [...SITES_QUERY_KEY, "list"],
    queryFn: () => ensureNativeApi().sites.list(),
    staleTime: 30_000,
  });
}

/** Publish and unpublish; both refresh every sites query when they finish. */
export function useSiteActions() {
  const queryClient = useQueryClient();
  const refresh = (result: SitesPublishResult) => {
    void queryClient.invalidateQueries({ queryKey: SITES_QUERY_KEY });
    return result;
  };
  const publish = useMutation({
    mutationFn: async (input: SitesPublishInput) =>
      refresh(await ensureNativeApi().sites.publish(input)),
  });
  const unpublish = useMutation({
    mutationFn: async (siteId: string) =>
      refresh(await ensureNativeApi().sites.unpublish({ siteId })),
  });
  return { publish, unpublish };
}

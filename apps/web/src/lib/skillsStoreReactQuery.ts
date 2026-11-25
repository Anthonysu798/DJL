// FILE: skillsStoreReactQuery.ts
// Purpose: React Query access to the Skills store: the catalog and installed skills, live
//          skills.sh search, SKILL.md previews, and install / update / remove.
// Layer: Web data helper

import type { SkillsStoreSkillInput, SkillsStoreSnapshot } from "@djl/contracts";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";
import { providerDiscoveryQueryKeys } from "./providerDiscoveryReactQuery";

export const SKILLS_STORE_QUERY_KEY = ["skills-store"] as const;

export function skillsStoreSnapshotQueryOptions() {
  return queryOptions({
    queryKey: [...SKILLS_STORE_QUERY_KEY, "snapshot"],
    queryFn: () => ensureNativeApi().skillsStore.snapshot(),
    staleTime: 60_000,
  });
}

export function skillsStoreSearchQueryOptions(query: string) {
  const trimmed = query.trim();
  return queryOptions({
    queryKey: [...SKILLS_STORE_QUERY_KEY, "search", trimmed.toLowerCase()],
    queryFn: async () => (await ensureNativeApi().skillsStore.search({ query: trimmed })).results,
    enabled: trimmed.length >= 2,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function skillsStorePreviewQueryOptions(id: string | null) {
  return queryOptions({
    queryKey: [...SKILLS_STORE_QUERY_KEY, "preview", id],
    queryFn: async () => (await ensureNativeApi().skillsStore.preview({ id: id! })).markdown,
    enabled: id !== null,
    staleTime: Infinity,
    retry: false,
  });
}

/** Install / update / remove; each puts the new snapshot in the cache and refreshes `$`. */
export function useSkillsStoreActions() {
  const queryClient = useQueryClient();
  const apply = (snapshot: SkillsStoreSnapshot) => {
    queryClient.setQueryData([...SKILLS_STORE_QUERY_KEY, "snapshot"], snapshot);
    void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
  };
  const install = useMutation({
    mutationFn: async (input: SkillsStoreSkillInput) => {
      const result = await ensureNativeApi().skillsStore.install(input);
      if (result.status === "done") apply(result.snapshot);
      return result;
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const snapshot = await ensureNativeApi().skillsStore.remove({ id });
      apply(snapshot);
      return snapshot;
    },
  });
  return { install, remove };
}

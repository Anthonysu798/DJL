import { useCallback, useEffect, useMemo, useState } from "react";

import {
  GITHUB_RELEASES_URL,
  readGithubReleaseCache,
  refreshGithubReleases,
  selectLatestStableRelease,
  type GithubReleaseNote,
  type ReleaseStorage,
} from "./githubReleases";

export interface GithubReleaseFeed {
  readonly releases: readonly GithubReleaseNote[];
  readonly latestStable: GithubReleaseNote | null;
  readonly status: "loading" | "ready" | "error";
  readonly refreshing: boolean;
  readonly retry: () => void;
  readonly releasesUrl: string;
}

function browserStorage(): ReleaseStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function useGithubReleases(): GithubReleaseFeed {
  const storage = useMemo(browserStorage, []);
  const initialCache = useMemo(() => (storage ? readGithubReleaseCache(storage) : null), [storage]);
  const [releases, setReleases] = useState<readonly GithubReleaseNote[]>(
    initialCache?.releases ?? [],
  );
  const [status, setStatus] = useState<GithubReleaseFeed["status"]>(
    initialCache ? "ready" : "loading",
  );
  const [refreshing, setRefreshing] = useState(initialCache ? !initialCache.fresh : true);
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    if (!storage) {
      setStatus("error");
      setRefreshing(false);
      return;
    }

    const cached = readGithubReleaseCache(storage);
    if (cached?.fresh && requestId === 0) {
      setReleases(cached.releases);
      setStatus("ready");
      setRefreshing(false);
      return;
    }

    let cancelled = false;
    setRefreshing(true);
    void refreshGithubReleases(storage)
      .then((nextReleases) => {
        if (cancelled) return;
        setReleases(nextReleases);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = readGithubReleaseCache(storage);
        if (fallback) {
          setReleases(fallback.releases);
          setStatus("ready");
        } else {
          setStatus("error");
        }
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requestId, storage]);

  const retry = useCallback(() => setRequestId((value) => value + 1), []);

  return {
    releases,
    latestStable: selectLatestStableRelease(releases),
    status,
    refreshing,
    retry,
    releasesUrl: GITHUB_RELEASES_URL,
  };
}

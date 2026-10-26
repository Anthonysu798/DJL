export interface AssetSnapshot {
  readonly source: "github" | "stats-worker";
  readonly dimensionKey: string;
  readonly value: bigint;
  readonly metadata: {
    readonly platform?: string;
    readonly version?: string;
    readonly name?: string;
    readonly assetType?: string;
  };
}
export type AnalyticsFetch = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_BYTES = 2 * 1024 * 1024;
const unavailable = () => new Error("Analytics source unavailable or invalid.");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
};
function count(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw unavailable();
  return BigInt(value);
}
async function sourceJson(
  url: string,
  fetchImpl: AnalyticsFetch,
  token?: string,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length") ?? 0) > MAX_BYTES ||
    !response.body
  )
    throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw unavailable();
  }
}

export async function readStatsWorkerSummary(
  options: { url?: string; token?: string; fetchImpl?: AnalyticsFetch } = {},
): Promise<readonly AssetSnapshot[]> {
  const url = new URL(options.url ?? "https://djl-stats.slcor.workers.dev");
  if (
    url.protocol !== "https:" ||
    !["djl-stats.slcor.workers.dev", "stats.slcor.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw unavailable();
  const root = object(
    await sourceJson(
      `${url.origin}/v1/${options.token ? "stats" : "public-stats"}`,
      options.fetchImpl ?? fetch,
      options.token,
    ),
  );
  const snapshots: AssetSnapshot[] = [];
  const section = (name: string, raw: unknown) => {
    const value = object(raw);
    snapshots.push({
      source: "stats-worker",
      dimensionKey: `${name}:total`,
      value: count(value.total),
      metadata: {},
    });
    for (const [field, prefix] of [
      ["bySource", "source"],
      ["byPlatform", "platform"],
      ["byVersion", "version"],
      ["byCountry", "country"],
    ] as const) {
      const values = value[field] === undefined ? {} : object(value[field]);
      if (Object.keys(values).length > 200) throw unavailable();
      for (const [key, total] of Object.entries(values)) {
        if (key.length > 128 || /[\r\n\t]/.test(key)) throw unavailable();
        snapshots.push({
          source: "stats-worker",
          dimensionKey: `${name}:${prefix}:${key}`,
          value: count(total),
          metadata:
            prefix === "platform"
              ? { platform: key }
              : prefix === "version"
                ? { version: key }
                : {},
        });
      }
    }
    const days = value.byDay ?? [];
    if (!Array.isArray(days) || days.length > 400) throw unavailable();
    for (const rawDay of days) {
      const row = object(rawDay);
      if (typeof row.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) throw unavailable();
      snapshots.push({
        source: "stats-worker",
        dimensionKey: `${name}:day:${row.day}`,
        value: count(row.count),
        metadata: {},
      });
    }
  };
  section("downloads", root.downloads);
  if (options.token && root.installs !== undefined) section("installs", root.installs);
  if (options.token && root.visits !== undefined) {
    const visits = object(root.visits);
    snapshots.push(
      {
        source: "stats-worker",
        dimensionKey: "visits:pageViews",
        value: count(visits.pageViews),
        metadata: {},
      },
      {
        source: "stats-worker",
        dimensionKey: "visits:uniqueBrowsers",
        value: count(visits.uniqueVisitors),
        metadata: {},
      },
    );
  }
  return snapshots;
}

export async function readGithubAssetCounts(options: {
  repo: string;
  fetchImpl?: AnalyticsFetch;
}): Promise<readonly AssetSnapshot[]> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(options.repo))
    throw unavailable();
  const snapshots: AssetSnapshot[] = [];
  for (let page = 1; page <= 10; page++) {
    const releases = await sourceJson(
      `https://api.github.com/repos/${options.repo}/releases?per_page=100&page=${page}`,
      options.fetchImpl ?? fetch,
    );
    if (!Array.isArray(releases) || releases.length > 100) throw unavailable();
    for (const raw of releases) {
      const release = object(raw);
      if (release.draft || typeof release.tag_name !== "string" || !/^v\d/.test(release.tag_name))
        continue;
      if (!Array.isArray(release.assets) || release.assets.length > 200) throw unavailable();
      for (const rawAsset of release.assets) {
        const asset = object(rawAsset);
        if (
          typeof asset.name !== "string" ||
          asset.name.length > 256 ||
          !/\.(dmg|exe|msi|zip|appimage|deb|rpm|tar\.gz)$/i.test(asset.name)
        )
          continue;
        if (!Number.isSafeInteger(asset.id) || Number(asset.id) < 1) throw unavailable();
        const name = asset.name;
        const installer = /\.(dmg|exe|msi|appimage|deb|rpm)$/i.test(name);
        const platform =
          /\.(dmg)$/i.test(name) || /mac|darwin/i.test(name)
            ? "mac"
            : /\.(exe|msi)$/i.test(name) || /win/i.test(name)
              ? "windows"
              : /linux|\.(appimage|deb|rpm)$/i.test(name)
                ? "linux"
                : "unknown";
        snapshots.push({
          source: "github",
          dimensionKey: `asset:${asset.id}`,
          value: count(asset.download_count),
          metadata: {
            name,
            platform,
            version: release.tag_name.slice(0, 128),
            assetType: installer ? "installer" : "archive",
          },
        });
      }
    }
    if (releases.length < 100) return snapshots;
  }
  throw new Error("Analytics source exceeded the bounded release window.");
}

import { describe, expect, it } from "vitest";
import { readGithubAssetCounts, readStatsWorkerSummary } from "./sources.ts";

describe("bounded analytics distribution sources", () => {
  it("reads public download counts without inventing private installation totals", async () => {
    const result = await readStatsWorkerSummary({
      fetchImpl: async () =>
        Response.json({
          downloads: {
            total: 17,
            bySource: { github: 12, oss: 5 },
            byPlatform: { mac: 10, windows: 7 },
            byDay: [{ day: "2026-10-12", count: 3 }],
          },
        }),
    });
    expect(result.find((row) => row.dimensionKey === "downloads:total")?.value).toBe(17n);
    expect(result.some((row) => row.dimensionKey.startsWith("installs:"))).toBe(false);
    expect(result.find((row) => row.dimensionKey === "downloads:day:2026-10-12")?.value).toBe(3n);
  });

  it("rejects malformed counts and unsafe source URLs instead of reporting zero", async () => {
    await expect(
      readStatsWorkerSummary({
        url: "http://127.0.0.1/private",
        fetchImpl: async () => Response.json({}),
      }),
    ).rejects.toThrow();
    await expect(
      readStatsWorkerSummary({
        fetchImpl: async () => Response.json({ downloads: { total: -1 } }),
      }),
    ).rejects.toThrow();
    await expect(
      readStatsWorkerSummary({
        fetchImpl: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow();
  });

  it("counts public desktop assets while excluding cloud/draft releases and updater manifests", async () => {
    const result = await readGithubAssetCounts({
      repo: "Anthonysu798/DJL",
      fetchImpl: async () =>
        Response.json([
          {
            tag_name: "v0.5.0",
            draft: false,
            assets: [
              { id: 101, name: "DJL-arm64.dmg", download_count: 42 },
              { id: 102, name: "latest-mac.yml", download_count: 300 },
            ],
          },
          {
            tag_name: "cloud-v0.2.0",
            draft: false,
            assets: [{ id: 103, name: "cloud.zip", download_count: 50 }],
          },
          {
            tag_name: "v0.6.0",
            draft: true,
            assets: [{ id: 104, name: "DJL.exe", download_count: 8 }],
          },
        ]),
    });
    expect(result).toEqual([
      {
        source: "github",
        dimensionKey: "asset:101",
        value: 42n,
        metadata: {
          name: "DJL-arm64.dmg",
          platform: "mac",
          version: "v0.5.0",
          assetType: "installer",
        },
      },
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STATS_URL, readStatsUrl, reportDownload } from "./downloadStats";

describe("readStatsUrl", () => {
  it("uses a safe override and otherwise falls back to the deployed Worker", () => {
    expect(readStatsUrl({ DJL_STATS_URL: "https://stats.example.workers.dev/" })).toBe(
      "https://stats.example.workers.dev",
    );
    expect(readStatsUrl({})).toBe(DEFAULT_STATS_URL);
    expect(readStatsUrl({ DJL_STATS_URL: "http://unsafe.example" })).toBe(DEFAULT_STATS_URL);
    expect(readStatsUrl({ DJL_STATS_URL: "https://user:pass@unsafe.example" })).toBe(
      DEFAULT_STATS_URL,
    );
  });
});

describe("reportDownload", () => {
  const report = {
    platform: "mac",
    arch: "arm64",
    source: "oss",
    country: "CN",
    version: "0.5.10",
  } as const;

  it("posts the resolved download report", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    };

    await reportDownload(report, { statsUrl: "https://stats.djl.test", fetchImpl });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://stats.djl.test/v1/downloads");
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual(report);
  });

  it("never rejects when analytics is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });

    await expect(
      reportDownload(report, { statsUrl: "https://stats.djl.test", fetchImpl }),
    ).resolves.toBeUndefined();
  });
});

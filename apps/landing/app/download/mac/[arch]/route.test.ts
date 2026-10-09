import { afterEach, describe, expect, it, vi } from "vitest";

const RELEASE = {
  tag_name: "v0.5.6",
  assets: [
    {
      name: "DJL-0.5.6-arm64.dmg",
      browser_download_url:
        "https://github.com/Anthonysu798/DJL/releases/download/v0.5.6/DJL-0.5.6-arm64.dmg",
    },
    {
      name: "DJL-0.5.6-x64.dmg",
      browser_download_url:
        "https://github.com/Anthonysu798/DJL/releases/download/v0.5.6/DJL-0.5.6-x64.dmg",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /download/mac/[arch]", () => {
  it.each([
    ["arm64", "https://github.com/Anthonysu798/DJL/releases/download/v0.5.6/DJL-0.5.6-arm64.dmg"],
    ["x64", "https://github.com/Anthonysu798/DJL/releases/download/v0.5.6/DJL-0.5.6-x64.dmg"],
  ])("redirects %s to its own disk image in the newest release", async (arch, expected) => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => RELEASE }));
    const { GET } = await import("./route");

    const response = await GET(new Request("https://djl.test"), {
      params: Promise.resolve({ arch }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(expected);
  });

  it("uses the GitHub release page rather than the retired VPS when GitHub is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const { GET } = await import("./route");

    const response = await GET(new Request("https://djl.test"), {
      params: Promise.resolve({ arch: "arm64" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/Anthonysu798/DJL/releases/latest",
    );
  });

  it.each([
    [
      "arm64",
      "https://djl-china-releases.oss-accelerate.aliyuncs.com/releases/0.5.6/DJL-0.5.6-arm64.dmg",
    ],
    [
      "x64",
      "https://djl-china-releases.oss-accelerate.aliyuncs.com/releases/0.5.6/DJL-0.5.6-x64.dmg",
    ],
  ])(
    "redirects the China button for %s to its immutable OSS disk image",
    async (arch, expected) => {
      vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => RELEASE }));
      const { GET } = await import("./route");

      const response = await GET(new Request("https://djl.test/download/mac/arm64?mirror=cn"), {
        params: Promise.resolve({ arch }),
      });

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(expected);
    },
  );

  it("rejects an unknown architecture instead of guessing one", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("./route");

    const response = await GET(new Request("https://djl.test"), {
      params: Promise.resolve({ arch: "sparc" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/Anthonysu798/DJL/releases/latest/download/SHA256SUMS",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports the resolved OSS redirect", async () => {
    const reports: Request[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("api.github.com")) {
        return { ok: true, json: async () => RELEASE };
      }
      reports.push(new Request(input, init));
      return new Response(null, { status: 204 });
    });
    const { GET } = await import("./route");

    await GET(
      new Request("https://djl.test/download/mac/arm64?mirror=cn", {
        headers: { "x-vercel-ip-country": "cn" },
      }),
      { params: Promise.resolve({ arch: "arm64" }) },
    );

    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(await reports[0]?.json()).toEqual({
      platform: "mac",
      arch: "arm64",
      source: "oss",
      country: "CN",
      version: "0.5.6",
    });
  });
});

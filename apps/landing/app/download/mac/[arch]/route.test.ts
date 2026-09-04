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
      "https://djl-china-releases.oss-cn-hongkong.aliyuncs.com/releases/0.5.6/DJL-0.5.6-arm64.dmg",
    ],
    [
      "x64",
      "https://djl-china-releases.oss-cn-hongkong.aliyuncs.com/releases/0.5.6/DJL-0.5.6-x64.dmg",
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
    const { GET } = await import("./route");

    const response = await GET(new Request("https://djl.test"), {
      params: Promise.resolve({ arch: "sparc" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/Anthonysu798/DJL/releases/latest/download/SHA256SUMS",
    );
  });
});

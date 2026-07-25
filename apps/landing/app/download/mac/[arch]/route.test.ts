import { afterEach, describe, expect, it, vi } from "vitest";

const RELEASE = {
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

  it("falls back to the VPS mirror for that architecture when GitHub is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const { GET } = await import("./route");

    const response = await GET(new Request("https://djl.test"), {
      params: Promise.resolve({ arch: "arm64" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://downloads.slcor.com/download/mac/arm64");
  });

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

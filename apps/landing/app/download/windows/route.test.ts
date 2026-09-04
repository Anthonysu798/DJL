import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /download/windows", () => {
  it("redirects to the newest published Windows installer", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.5.6",
        assets: [
          {
            name: "DJL-0.5.6-x64.exe",
            browser_download_url:
              "https://github.com/Anthonysu798/DJL/releases/download/v0.5.6/DJL-0.5.6-x64.exe",
          },
        ],
      }),
    }));
    const { GET } = await import("./route");

    const response = await GET(new Request("https://djl.test/download/windows"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/Anthonysu798/DJL/releases/download/v0.5.6/DJL-0.5.6-x64.exe",
    );
  });

  it("uses the GitHub release page rather than the retired VPS when GitHub is unreachable", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => null }));
    const { GET } = await import("./route");

    const response = await GET(new Request("https://djl.test/download/windows"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/Anthonysu798/DJL/releases/latest",
    );
  });

  it("redirects the China button to the immutable Hong Kong OSS installer", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.5.6",
        assets: [
          {
            name: "DJL-0.5.6-x64.exe",
            browser_download_url:
              "https://github.com/Anthonysu798/DJL/releases/download/v0.5.6/DJL-0.5.6-x64.exe",
          },
        ],
      }),
    }));
    const { GET } = await import("./route");

    const response = await GET(new Request("https://djl.test/download/windows?mirror=cn"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://djl-china-releases.oss-cn-hongkong.aliyuncs.com/releases/0.5.6/DJL-0.5.6-x64.exe",
    );
  });
});

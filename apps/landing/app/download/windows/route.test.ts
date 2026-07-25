import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /download/windows", () => {
  it("redirects to the newest published Windows installer", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
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

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/Anthonysu798/DJL/releases/download/v0.5.6/DJL-0.5.6-x64.exe",
    );
  });

  it("falls back to the VPS mirror rather than failing the download", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => null }));
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://downloads.slcor.com/download/windows");
  });
});

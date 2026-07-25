import { afterEach, describe, expect, it, vi } from "vitest";

function stubRelease(release: unknown, ok = true): void {
  vi.stubGlobal("fetch", async () => ({ ok, json: async () => release }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /download/mac", () => {
  it("sends architecture-agnostic requests to the newest release listing", async () => {
    stubRelease({ html_url: "https://github.com/Anthonysu798/DJL/releases/tag/v0.5.6" });
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/Anthonysu798/DJL/releases/tag/v0.5.6",
    );
  });

  it("falls back to the VPS compatibility page when GitHub is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://downloads.slcor.com/download/mac");
  });
});

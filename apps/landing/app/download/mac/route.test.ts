import { describe, expect, it } from "vitest";

describe("GET /download/mac", () => {
  it("redirects legacy macOS downloads to the stable VPS Mac endpoint", async () => {
    const { GET } = await import("./route");

    const response = GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://downloads.slcor.com/download/mac");
  });
});

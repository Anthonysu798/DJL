import { describe, expect, it } from "vitest";

import { MARKETPLACE_MAX_BYTES, fetchMarketplace } from "./marketplace";

// Only the call itself is used, not the extras a runtime hangs on `fetch`.
const fake = (handler: (url: string, init?: RequestInit) => Promise<Response>) =>
  (async (url: unknown, init?: RequestInit) =>
    handler(String(url), init)) as unknown as typeof fetch;
const URL_ = "https://market.example/plugins.json";

describe("fetchMarketplace", () => {
  it("asks for JSON with a time limit and without following redirects", async () => {
    let seen: RequestInit | undefined;
    await fetchMarketplace(
      fake(async (_url, init) => {
        seen = init;
        return Response.json({ name: "M", plugins: [] });
      }),
      URL_,
    );
    expect(seen?.redirect).toBe("error");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses a file that is too big, not JSON, or not a marketplace", async () => {
    const big = "x".repeat(MARKETPLACE_MAX_BYTES + 1);
    await expect(
      fetchMarketplace(
        fake(async () => new Response(big)),
        URL_,
      ),
    ).rejects.toThrow("too big");
    await expect(
      fetchMarketplace(
        fake(async () => new Response("<html>")),
        URL_,
      ),
    ).rejects.toThrow("not valid JSON");
    await expect(
      fetchMarketplace(
        fake(async () => Response.json({ name: "", plugins: [] })),
        URL_,
      ),
    ).rejects.toThrow("needs a name and a list of plugins");
    await expect(
      fetchMarketplace(
        fake(async () => new Response("", { status: 404 })),
        URL_,
      ),
    ).rejects.toThrow("HTTP 404");
    await expect(
      fetchMarketplace(
        fake(async () => {
          throw new Error("offline");
        }),
        URL_,
      ),
    ).rejects.toThrow("could not reach");
  });

  it("counts duplicate ids as skipped", async () => {
    const plugin = {
      id: "a",
      name: "a",
      displayName: "A",
      shortDescription: "A",
      mcpServers: [{ name: "A", url: "https://a.example/mcp" }],
    };
    const result = await fetchMarketplace(
      fake(async () => Response.json({ name: " M ", plugins: [plugin, plugin, 3] })),
      URL_,
    );
    expect(result.name).toBe("M");
    expect(result.plugins.map((item) => item.id)).toEqual(["a"]);
    expect(result.skipped).toBe(2);
  });
});

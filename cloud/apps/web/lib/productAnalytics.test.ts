import { afterEach, expect, it, vi } from "vitest";
import { createWebAnalytics } from "./productAnalytics";
import { csrf } from "./api";

vi.mock("./config", () => ({ API_URL: "https://api.example.test" }));
vi.mock("./api", () => ({ csrf: vi.fn(async () => "csrf-fixture") }));
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("sends consented web activity with cookie/CSRF protection and no account id in the body", async () => {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const request = new Request(url, init);
    requests.push(request);
    return url.endsWith("/installations")
      ? Response.json(
          {
            credential: "a".repeat(43),
            installationId: (await request.clone().json()).installationId,
          },
          { status: 201 },
        )
      : Response.json({ accepted: 1 });
  });
  const client = createWebAnalytics(() => "private-account-fixture");
  await client.start();
  expect(requests).toHaveLength(0);
  await client.setEnabled(true);
  await client.recordFeature("images");
  expect(requests.every((request) => request.credentials === "include")).toBe(true);
  expect(requests.every((request) => request.headers.get("x-csrf-token") === "csrf-fixture")).toBe(
    true,
  );
  expect(JSON.stringify(await requests.at(-1)!.clone().json())).not.toContain(
    "private-account-fixture",
  );
  expect(vi.mocked(csrf).mock.calls.length).toBeGreaterThan(0);
  client.close();
});

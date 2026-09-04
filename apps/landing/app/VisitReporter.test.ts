import { describe, expect, it, vi } from "vitest";

import { reportPathname } from "./VisitReporter";

describe("reportPathname", () => {
  it("posts only the current pathname to the same-origin visit route", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(new Request(new URL(String(input), "https://djl.test"), init));
      return new Response(null, { status: 204 });
    };

    await reportPathname("/guide", fetchImpl);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://djl.test/api/visits");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(await requests[0]?.json()).toEqual({ path: "/guide" });
    expect(requests[0]?.keepalive).toBe(true);
  });

  it("never rejects when same-origin reporting fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    await expect(reportPathname("/", fetchImpl)).resolves.toBeUndefined();
  });
});

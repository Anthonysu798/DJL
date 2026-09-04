import { describe, expect, it, vi } from "vitest";

import {
  normalizeVisitPath,
  normalizeVisitorId,
  reportVisitToWorker,
  resolveVisitorIdentity,
} from "./visitTracking";

const VISITOR_ID = "f4d1b4dc-3ff4-4fcf-89b8-658884d0be87";
const REPLACEMENT_ID = "6f1c2c0e-2b3a-4c4d-9e8f-0a1b2c3d4e5f";

describe("visitor identity", () => {
  it("reuses and normalizes a valid anonymous UUID", () => {
    expect(normalizeVisitorId(VISITOR_ID.toUpperCase())).toBe(VISITOR_ID);
    expect(resolveVisitorIdentity(VISITOR_ID.toUpperCase(), () => REPLACEMENT_ID)).toEqual({
      visitorId: VISITOR_ID,
      isNew: false,
    });
  });

  it("replaces a missing or invalid visitor id with secure injected randomness", () => {
    const randomUUID = vi.fn(() => REPLACEMENT_ID);
    expect(resolveVisitorIdentity(undefined, randomUUID)).toEqual({
      visitorId: REPLACEMENT_ID,
      isNew: true,
    });
    expect(resolveVisitorIdentity("invalid", randomUUID)).toEqual({
      visitorId: REPLACEMENT_ID,
      isNew: true,
    });
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });
});

describe("normalizeVisitPath", () => {
  it("accepts a pathname but rejects URL data outside the path", () => {
    expect(normalizeVisitPath("/")).toBe("/");
    expect(normalizeVisitPath("/guide/getting-started")).toBe("/guide/getting-started");
    expect(normalizeVisitPath("guide")).toBeNull();
    expect(normalizeVisitPath("//external.example/path")).toBeNull();
    expect(normalizeVisitPath("/guide?token=secret")).toBeNull();
    expect(normalizeVisitPath("/guide#private")).toBeNull();
    expect(normalizeVisitPath(`/${"x".repeat(256)}`)).toBeNull();
  });
});

describe("reportVisitToWorker", () => {
  const report = { visitorId: VISITOR_ID, path: "/guide", country: "CA" } as const;

  it("posts only the anonymous visit payload", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    };

    await reportVisitToWorker(report, {
      statsUrl: "https://stats.djl.test",
      fetchImpl,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://stats.djl.test/v1/visits");
    expect(await requests[0]?.json()).toEqual(report);
  });

  it("never rejects when analytics is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    await expect(
      reportVisitToWorker(report, { statsUrl: "https://stats.djl.test", fetchImpl }),
    ).resolves.toBeUndefined();
  });
});

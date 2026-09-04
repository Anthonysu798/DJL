import { describe, expect, it, vi } from "vitest";

import { handleVisitRequest } from "../../lib/visitRoute";

const VISITOR_ID = "f4d1b4dc-3ff4-4fcf-89b8-658884d0be87";

describe("POST /api/visits", () => {
  it("creates a private visitor cookie and schedules the first page view", async () => {
    const reports: unknown[] = [];
    const tasks: Array<Promise<void>> = [];
    const response = await handleVisitRequest(
      new Request("https://djl.test/api/visits", {
        method: "POST",
        body: JSON.stringify({ path: "/guide" }),
      }),
      {
        cookieValue: undefined,
        country: "CA",
        randomUUID: () => VISITOR_ID,
        isProduction: true,
        schedule: (task) => tasks.push(task()),
        report: async (report) => {
          reports.push(report);
        },
      },
    );
    await Promise.all(tasks);

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`djl_visitor_id=${VISITOR_ID}`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=15552000");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(reports).toEqual([{ visitorId: VISITOR_ID, path: "/guide", country: "CA" }]);
  });

  it("reuses an existing valid cookie without resetting it", async () => {
    const report = vi.fn(async () => {});
    const tasks: Array<Promise<void>> = [];
    const response = await handleVisitRequest(
      new Request("https://djl.test/api/visits", {
        method: "POST",
        body: JSON.stringify({ path: "/" }),
      }),
      {
        cookieValue: VISITOR_ID.toUpperCase(),
        country: null,
        randomUUID: () => "6f1c2c0e-2b3a-4c4d-9e8f-0a1b2c3d4e5f",
        isProduction: false,
        schedule: (task) => tasks.push(task()),
        report,
      },
    );
    await Promise.all(tasks);

    expect(response.status).toBe(204);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(report).toHaveBeenCalledWith({ visitorId: VISITOR_ID, path: "/", country: null });
  });

  it("rejects query data and does not schedule a report", async () => {
    const schedule = vi.fn();
    const response = await handleVisitRequest(
      new Request("https://djl.test/api/visits", {
        method: "POST",
        body: JSON.stringify({ path: "/guide?token=private" }),
      }),
      {
        cookieValue: VISITOR_ID,
        country: "CA",
        randomUUID: () => VISITOR_ID,
        isProduction: true,
        schedule,
        report: async () => {},
      },
    );

    expect(response.status).toBe(400);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const schedule = vi.fn();
    const response = await handleVisitRequest(
      new Request("https://djl.test/api/visits", { method: "POST", body: "{" }),
      {
        cookieValue: VISITOR_ID,
        country: null,
        randomUUID: () => VISITOR_ID,
        isProduction: false,
        schedule,
        report: async () => {},
      },
    );

    expect(response.status).toBe(400);
    expect(schedule).not.toHaveBeenCalled();
  });
});

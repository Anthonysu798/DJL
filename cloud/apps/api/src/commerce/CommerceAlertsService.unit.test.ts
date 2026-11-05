import type { DjlDatabase } from "@djl/db";
import { describe, expect, it, vi } from "vitest";
import { CommerceAlertsService, commerceAlertsEnabled } from "./CommerceAlertsService.ts";

describe("commerce monitoring opt-in and input boundaries", () => {
  it("adds durable email status in one bounded batch without dispatching from the API", async () => {
    const at = "2030-01-01T00:00:00.000000Z";
    const rows = Array.from({ length: 101 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      kind: "withdrawal_requested",
      resourceType: "withdrawal",
      resourceId: "00000000-0000-4000-8000-999999999999",
      orderId: null,
      sourceStatus: "requested",
      state: "open",
      firstDetectedAt: at,
      openedAt: at,
      lastSeenAt: at,
      resolvedAt: null,
      lastTransitionAt: at,
    }));
    const execute = vi.fn(async () => [
      {
        data: {
          monitor: {
            status: "never_scanned",
            lastSuccessfulScanAt: null,
            intervalSeconds: 300,
            staleAfterSeconds: 900,
          },
          open: "101",
          pending: "0",
          rows,
        },
      },
    ]);
    const summary = {
      enabled: false,
      configuration: "disabled" as const,
      mode: "mock" as const,
      counts: { pending: 0, submitting: 0, accepted: 0, simulated: 0, needsReview: 1, skipped: 0 },
      lastAttemptAt: at,
    };
    const delivery = {
      mode: "resend" as const,
      state: "needs_review" as const,
      attemptedAt: at,
      completedAt: at,
      reasonCode: "delivery_interrupted",
    };
    const status = vi.fn(async () => ({ summary, deliveries: { [rows[0]!.id]: delivery } }));
    const service = new CommerceAlertsService({ execute } as unknown as DjlDatabase, {
      environment: "test",
      emailDelivery: { status },
    });
    const result = await service.list();
    expect(execute).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledWith(rows.slice(0, 100).map((row) => row.id));
    expect(result.incidents).toHaveLength(100);
    expect(result.incidents[0]!.emailDelivery).toEqual(delivery);
    expect(result.incidents[1]!.emailDelivery).toBeNull();
    expect(result.externalDelivery).toEqual(summary);
    expect(result.nextCursor).not.toBeNull();
  });

  it("requires exact explicit flags and a recognized deployment environment", () => {
    for (const environment of ["local", "test", "staging", "production"]) {
      expect(commerceAlertsEnabled("true", environment)).toBe(true);
      expect(commerceAlertsEnabled("1", environment)).toBe(true);
      for (const value of [undefined, "", false, true, "TRUE", " true", "yes", "0"])
        expect(commerceAlertsEnabled(value, environment)).toBe(false);
    }
    for (const environment of ["", "unknown", "Production"])
      expect(commerceAlertsEnabled("true", environment)).toBe(false);
  });
  it("disabled or unknown-environment scans do not touch the database or invent zero counts", async () => {
    const transaction = vi.fn(() => {
      throw new Error("Must not query");
    });
    for (const options of [
      { environment: "test" },
      { enabled: false, environment: "production" },
      { enabled: true, environment: "unknown" },
    ]) {
      const service = new CommerceAlertsService({ transaction } as unknown as DjlDatabase, options);
      expect(await service.scan()).toEqual({
        enabled: false,
        skipped: true,
        opened: null,
        resolved: null,
        pending: null,
        open: null,
        scannedAt: null,
      });
    }
    expect(transaction).not.toHaveBeenCalled();
  });
  it("rejects invalid filter/cursor inputs before database access", async () => {
    const execute = vi.fn(() => {
      throw new Error("Must not query");
    });
    const service = new CommerceAlertsService({ execute } as unknown as DjlDatabase, {
      environment: "test",
    });
    for (const status of ["pending", "anything", [], 1])
      await expect(service.list({ status })).rejects.toMatchObject({ status: 400 });
    for (const cursor of [
      "",
      "not-base64!",
      1,
      "a".repeat(513),
      Buffer.from(
        JSON.stringify({
          at: "2026-02-30T00:00:00.000000Z",
          id: "00000000-0000-4000-8000-000000000001",
        }),
      ).toString("base64url"),
    ])
      await expect(service.list({ cursor })).rejects.toMatchObject({ status: 400 });
    expect(execute).not.toHaveBeenCalled();
  });
  it("failed scans are unavailable, never successful empty scans", async () => {
    const transaction = vi.fn(async () => {
      throw new Error("private database diagnostic");
    });
    const service = new CommerceAlertsService({ transaction } as unknown as DjlDatabase, {
      enabled: true,
      environment: "test",
    });
    await expect(service.scan()).rejects.toMatchObject({
      status: 503,
      code: "commerce_alert_scan_failed",
    });
    await expect(service.scan()).rejects.not.toHaveProperty(
      "message",
      "private database diagnostic",
    );
  });
});

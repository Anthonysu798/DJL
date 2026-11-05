import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CommerceAlertIncident, CommerceAlertsResponse } from "@synara/contracts/cloud";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { admin, getToken } = vi.hoisted(() => ({ admin: vi.fn(), getToken: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
  getToken,
}));
import { AdminApiError } from "@/lib/api";
import { CommerceAlerts } from "./CommerceAlerts";

const incident: CommerceAlertIncident = {
  id: "alert-1",
  kind: "payment_unresolved",
  resourceType: "payment_attempt",
  resourceId: "attempt-1",
  orderId: "old-order-1",
  sourceStatus: "unknown",
  state: "open",
  firstDetectedAt: "2026-10-26T12:00:00.000001Z",
  openedAt: "2026-10-26T12:15:00.000001Z",
  lastSeenAt: "2026-10-26T12:15:00.000001Z",
  resolvedAt: null,
  lastTransitionAt: "2026-10-26T12:15:00.000001Z",
  emailDelivery: null,
};
const response: CommerceAlertsResponse = {
  enabled: true,
  externalDelivery: {
    enabled: false,
    configuration: "disabled",
    mode: "mock",
    counts: { pending: 0, submitting: 0, accepted: 0, simulated: 0, needsReview: 0, skipped: 0 },
    lastAttemptAt: null,
  },
  monitor: {
    status: "healthy",
    lastSuccessfulScanAt: "2026-10-26T12:15:00.000001Z",
    intervalSeconds: 300,
    staleAfterSeconds: 900,
  },
  counts: { open: 101, pending: 4 },
  incidents: [incident],
  nextCursor: "server_cursor_2",
};
let host: HTMLDivElement, root: Root;
const onOrder = vi.fn(async () => {}),
  onWithdrawal = vi.fn(async () => {});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  admin.mockReset();
  getToken.mockReset();
  getToken.mockReturnValue("admin-a");
  onOrder.mockReset();
  onWithdrawal.mockReset();
  admin.mockResolvedValue(response);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const show = async () => {
  await act(async () =>
    root.render(<CommerceAlerts onOrder={onOrder} onWithdrawal={onWithdrawal} />),
  );
};
const click = async (label: string) => {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
};
const filter = async (value: string) => {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="告警范围"]')!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
describe("commerce administrator operational incident queue", () => {
  it("ends loading without showing health when its current request expires the login", async () => {
    let reject!: (value: unknown) => void;
    admin
      .mockImplementationOnce(
        () =>
          new Promise((_done, fail) => {
            reject = fail;
          }),
      )
      .mockRejectedValue(new AdminApiError(401, "unauthorized", "Expired"));
    await show();
    getToken.mockReturnValue(null);
    await act(async () => reject(new AdminApiError(401, "unauthorized", "Expired")));
    expect(host.textContent).not.toContain("正在查询监控");
    expect(host.textContent).not.toContain("已记录待处理");
  });
  it.each([
    ["disabled", "mock", "邮件提醒已关闭"],
    ["unavailable", "resend", "邮件配置未就绪"],
    ["ready", "mock", "模拟邮件提醒"],
    ["ready", "resend", "邮件服务已配置"],
  ] as const)(
    "shows %s/%s configuration without promising receipt",
    async (configuration, mode, text) => {
      admin.mockResolvedValue({
        ...response,
        externalDelivery: {
          ...response.externalDelivery,
          enabled: configuration !== "disabled",
          configuration,
          mode,
        },
      });
      await show();
      expect(host.textContent).toContain(text);
      expect(host.textContent).toContain("不代表收件确认");
      expect(
        [...host.querySelectorAll("button")].some((node) => /重发/.test(node.textContent ?? "")),
      ).toBe(false);
    },
  );
  it.each([
    ["pending", "等待处理"],
    ["submitting", "请求提交中"],
    ["accepted", "服务商已接受请求"],
    ["simulated", "模拟记录，未发送邮件"],
    ["needs_review", "发送结果需人工复核"],
    ["skipped_resolved", "异常已恢复，已跳过发送"],
  ] as const)(
    "shows the recorded %s delivery state without a resend action",
    async (state, text) => {
      admin.mockResolvedValue({
        ...response,
        incidents: [
          {
            ...incident,
            emailDelivery: {
              mode: "mock",
              state,
              attemptedAt: response.monitor.lastSuccessfulScanAt,
              completedAt: null,
              reasonCode: "test_reason",
            },
          },
        ],
      });
      await show();
      expect(host.textContent).toContain(text);
      expect(host.textContent).toContain("不会自动重发");
      if (state === "submitting")
        expect(host.textContent).toContain(
          "已认领超过2分钟仍未确认，请人工核查；停用或配置无效时不会自动改写该记录或重发。",
        );
      expect(host.textContent).not.toContain("已送达");
      expect(
        [...host.querySelectorAll("button")].some((node) => /重发/.test(node.textContent ?? "")),
      ).toBe(false);
    },
  );
  it("does not fill a new account with the former account's delayed alert response", async () => {
    let finish!: (value: CommerceAlertsResponse) => void;
    admin
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            finish = done;
          }),
      )
      .mockResolvedValue({ ...response, incidents: [], counts: { open: 0, pending: 0 } });
    await show();
    getToken.mockReturnValue("admin-b");
    await show();
    await act(async () => finish(response));
    expect(host.textContent).not.toContain("old-order-1");
    expect(host.textContent).not.toContain("已记录待处理 101 条");
    expect(admin).toHaveBeenCalledTimes(2);
  });
  it("ignores a late request after unmount and keeps a new instance's result", async () => {
    let finish!: (value: CommerceAlertsResponse) => void;
    admin
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            finish = done;
          }),
      )
      .mockResolvedValue({ ...response, incidents: [], counts: { open: 0, pending: 0 } });
    await show();
    await act(async () => root.render(<></>));
    await show();
    await act(async () => finish(response));
    expect(host.textContent).not.toContain("old-order-1");
    expect(host.textContent).toContain("已记录待处理 0 条");
  });
  it("shows server monitoring health and separate pending counts, without promising external delivery or money movement", async () => {
    await show();
    expect(admin).toHaveBeenCalledExactlyOnceWith("/commerce/alerts");
    expect(host.textContent).toContain("自动监控：已启用");
    expect(host.textContent).toContain("已记录待处理 101 条");
    expect(host.textContent).toContain("连续观察中 4 条");
    expect(host.textContent).toContain("邮件提醒已关闭");
    expect(host.textContent).toContain(response.monitor.lastSuccessfulScanAt);
    expect(host.textContent).toContain("不会自动退款、重付、放款或修改账本");
  });
  it("uses server cursors, restores previous pages, and resets pagination only after a successful filter query", async () => {
    admin.mockImplementation(async (path: string) =>
      path.includes("status=resolved")
        ? {
            ...response,
            nextCursor: null,
            incidents: [
              { ...incident, state: "resolved", resolvedAt: "2026-10-26T12:20:00.000001Z" },
            ],
          }
        : path.includes("cursor=")
          ? { ...response, nextCursor: null, incidents: [{ ...incident, id: "alert-2" }] }
          : response,
    );
    await show();
    await click("下一页告警");
    expect(admin).toHaveBeenLastCalledWith("/commerce/alerts?cursor=server_cursor_2");
    expect(host.textContent).toContain("第 2 页");
    await click("上一页告警");
    expect(admin).toHaveBeenLastCalledWith("/commerce/alerts");
    await filter("resolved");
    expect(admin).toHaveBeenLastCalledWith("/commerce/alerts?status=resolved");
    expect(host.textContent).toContain("第 1 页");
    expect(host.textContent).toContain("该类异常已恢复");
    expect(host.textContent).toContain("不代表此订单其他异常");
    expect((host.querySelector('select[aria-label="告警范围"]') as HTMLSelectElement).value).toBe(
      "resolved",
    );
  });
  it("removes previous health/counts after failed reads and does not claim an empty healthy queue", async () => {
    await show();
    admin.mockRejectedValueOnce(new TypeError("Offline"));
    await filter("all");
    expect(host.textContent).toContain("告警查询失败，不能据此判断没有异常");
    expect(host.textContent).not.toContain("已记录待处理");
    expect(host.textContent).not.toContain("最近一次扫描正常完成");
    expect((host.querySelector('select[aria-label="告警范围"]') as HTMLSelectElement).value).toBe(
      "open",
    );
    await click("刷新告警");
    expect(admin).toHaveBeenLastCalledWith("/commerce/alerts");
    expect(host.textContent).toContain("已记录待处理 101 条");
  });
  it("makes disabled, never-scanned and stale states explicit instead of treating zero records as health", async () => {
    for (const [status, text] of [
      ["disabled", "监控未启用"],
      ["never_scanned", "尚无成功扫描记录"],
      ["stale", "扫描记录已过期"],
    ] as const) {
      admin.mockResolvedValueOnce({
        ...response,
        enabled: status !== "disabled",
        monitor: {
          ...response.monitor,
          status,
          lastSuccessfulScanAt:
            status === "never_scanned" ? null : response.monitor.lastSuccessfulScanAt,
        },
        counts: { open: 0, pending: 0 },
        incidents: [],
      });
      if (!host.firstChild) await show();
      else await click("刷新告警");
      expect(host.textContent).toContain(text);
      expect(host.textContent).not.toContain("最近一次扫描正常完成");
      expect(host.textContent).toContain("不能据此认定没有异常");
    }
  });
  it("hands off only confirmed order/withdrawal IDs and never guesses an unmatched event's owner", async () => {
    admin.mockResolvedValue({
      ...response,
      nextCursor: null,
      incidents: [
        incident,
        {
          ...incident,
          id: "withdraw-alert",
          orderId: null,
          resourceType: "withdrawal",
          resourceId: "old-withdrawal-1",
          kind: "withdrawal_requested",
        },
        {
          ...incident,
          id: "event-alert",
          orderId: null,
          resourceType: "payment_event",
          resourceId: "evt_unmapped",
          kind: "event_review_unmapped",
        },
      ],
    });
    await show();
    await click("定位订单 old-order-1");
    await click("定位提现 old-withdrawal-1");
    expect(onOrder).toHaveBeenCalledExactlyOnceWith("old-order-1");
    expect(onWithdrawal).toHaveBeenCalledExactlyOnceWith("old-withdrawal-1");
    expect(host.textContent).toContain("evt_unmapped");
    expect(host.textContent).toContain("不会猜测订单");
    expect(admin.mock.calls.every(([, init]) => !init)).toBe(true);
  });
  it("preserves order drill-through but not withdrawal drill-through for a monitoring-only session", async () => {
    admin.mockResolvedValue({
      ...response,
      incidents: [
        incident,
        {
          ...incident,
          id: "withdraw-alert",
          orderId: null,
          resourceType: "withdrawal",
          resourceId: "old-withdrawal-1",
          kind: "withdrawal_requested",
        },
      ],
    });
    await act(async () => root.render(<CommerceAlerts onOrder={onOrder} />));
    await click("定位订单 old-order-1");
    expect(onOrder).toHaveBeenCalledExactlyOnceWith("old-order-1");
    expect(host.textContent).toContain("提现申请需要跟进");
    expect(host.textContent).not.toContain("定位提现 old-withdrawal-1");
    expect(admin.mock.calls).toEqual([["/commerce/alerts"]]);
  });
  it("keeps a failed direct lookup on the alert page and polls monitoring without creating operations", async () => {
    vi.useFakeTimers();
    onOrder.mockRejectedValueOnce(new Error("Not found"));
    await show();
    await click("定位订单 old-order-1");
    expect(host.textContent).toContain("定位失败，未进入处理页面");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(admin).toHaveBeenCalledTimes(2);
    expect(admin.mock.calls.every(([path, init]) => path === "/commerce/alerts" && !init)).toBe(
      true,
    );
  });
});

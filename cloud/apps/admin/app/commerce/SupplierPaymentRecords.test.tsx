import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CommerceSupplierPaymentDocument,
  CommerceSupplierPaymentDocumentInput,
} from "@synara/contracts/cloud";
const { admin, getToken } = vi.hoisted(() => ({ admin: vi.fn(), getToken: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
  getToken,
}));
import { AdminApiError } from "@/lib/api";
import { SupplierPaymentRecords } from "./SupplierPaymentRecords";

const supplier = { id: "supplier-a", name: "Synthetic Supplier A" };
const other = { id: "supplier-b", name: "Synthetic Supplier B" };
const base = "/commerce/suppliers/supplier-a/payment-records";
const meta = {
  mode: "test",
  currency: "CAD",
  supplierSettlement: "unsupported",
  recordingEnabled: true,
  disabledReason: null,
} as const;
const fields = {
  amountCents: "1234",
  reference: "  TEST-REF  ",
  evidenceReference: "  TEST-EVIDENCE  ",
  reason: "  Synthetic TEST document only  ",
};
const doc = (
  input: CommerceSupplierPaymentDocumentInput,
  id = "document-a",
): CommerceSupplierPaymentDocument => ({
  ...input,
  id,
  supplierId: supplier.id,
  mode: "test",
  source: "unverified_manual_test_document",
  recordedBy: "recording-admin",
  recordedAt: "2026-10-29T12:00:00Z",
  bankVerified: false,
  settlementApplied: false,
  referenceShared: false,
});
let host: HTMLDivElement, root: Root;
let rows: CommerceSupplierPaymentDocument[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  admin.mockReset();
  getToken.mockReset();
  getToken.mockReturnValue("admin-a");
  rows = [];
  admin.mockImplementation(async (path, init) => {
    if (init?.method === "POST") {
      const record = doc(init.json);
      rows = [record];
      return { ...meta, record };
    }
    if (path.includes("/by-operation/")) return { ...meta, record: rows[0] };
    return {
      ...meta,
      records: rows,
      page: path.includes("page=1") ? 1 : 0,
      pageSize: 100,
      hasMore: false,
    };
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const show = async (
  selected: typeof supplier | null = supplier,
  disabled = false,
  canWrite = true,
) => {
  await act(async () =>
    root.render(
      <SupplierPaymentRecords supplier={selected} disabled={disabled} canWrite={canWrite} />,
    ),
  );
};
const button = (label: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label,
  );
  if (!found) throw Error("Missing " + label);
  return found;
};
const click = async (label: string) => {
  await act(async () => button(label).click());
};
const form = () => button("登记 TEST 付款资料").closest("form")!;
const fill = (target: HTMLFormElement, values = fields) => {
  for (const [name, value] of Object.entries(values))
    (target.elements.namedItem(name) as HTMLInputElement).value = value;
  (target.elements.namedItem("acknowledge") as HTMLInputElement).checked = true;
};
const submit = async (target: HTMLFormElement) => {
  await act(async () => {
    target.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};
const posts = () => admin.mock.calls.filter(([, init]) => init?.method === "POST");

describe("supplier TEST documents do not settle funds", () => {
  it("keeps readback but stops retry after finance write access is removed during its required lookup", async () => {
    const normal = admin.getMockImplementation()!;
    let rejectRetry!: (reason: unknown) => void;
    let lookups = 0;
    admin.mockImplementation(async (path, init) => {
      if (init?.method === "POST") throw new TypeError("Response lost");
      if (path.includes("/by-operation/")) {
        lookups++;
        if (lookups === 1)
          return new Promise((_, reject) => {
            rejectRetry = reject;
          });
        return { ...meta, record: doc(posts()[0]![1].json) };
      }
      return normal(path, init);
    });
    await show();
    fill(form());
    await submit(form());
    await click("按原完整请求重试资料登记");
    expect(lookups).toBe(1);
    await show(supplier, false, false);
    await act(async () => rejectRetry(new AdminApiError(404, "not_found", "No document")));
    expect(posts()).toHaveLength(1);
    expect(host.textContent).not.toContain("按原完整请求重试资料登记");
    await click("只读查询原资料");
    expect(lookups).toBe(2);
    expect(host.textContent).toContain("资料已只读核对");
    expect(host.textContent).not.toContain("登记另一条资料");
    expect(posts()).toHaveLength(1);
  });
  it("requires a selected supplier, shows separate TEST history when recording is off, and never derives a payable amount", async () => {
    await show(null);
    expect(admin).not.toHaveBeenCalled();
    admin.mockResolvedValue({
      ...meta,
      recordingEnabled: false,
      disabledReason: "test_recording_paused",
      records: [
        doc({
          operationId: "old-operation",
          amountCents: 700,
          currency: "CAD",
          reference: "OLD-REF",
          evidenceReference: "OLD-EVIDENCE",
          reason: "Historical TEST only",
        }),
      ],
      page: 0,
      pageSize: 100,
      hasMore: false,
    });
    await show();
    expect(host.textContent).toContain("OLD-REF");
    expect(host.textContent).toContain("登记未启用");
    expect(host.textContent).toContain("不冲减采购应付");
    expect(host.querySelector('input[name="amountCents"]')).toBeNull();
    expect(posts()).toHaveLength(0);
  });
  it("records only explicit whole CAD cents, the original supplier and a canonical TEST document", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await show();
    expect((form().elements.namedItem("amountCents") as HTMLInputElement).value).toBe("");
    fill(form());
    await submit(form());
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toEqual([
      base,
      {
        method: "POST",
        json: {
          operationId: expect.any(String),
          amountCents: 1234,
          currency: "CAD",
          reference: "TEST-REF",
          evidenceReference: "TEST-EVIDENCE",
          reason: "Synthetic TEST document only",
        },
      },
    ]);
    expect(host.textContent).toContain("资料已只读核对");
    expect(host.textContent).toContain("未结算");
    expect(host.textContent).not.toContain("银行已核验");
    expect(storage).not.toHaveBeenCalled();
    expect(admin).toHaveBeenCalledWith(base + "/by-operation/" + posts()[0]![1].json.operationId);
  });
  it("requires acknowledgement and rejects fractional, exponent, zero and unsafe cents without a POST", async () => {
    await show();
    const target = form();
    fill(target);
    (target.elements.namedItem("acknowledge") as HTMLInputElement).checked = false;
    await submit(target);
    expect(host.textContent).toContain("请确认");
    for (const value of ["", "0", "12.34", "1e3", "9007199254740992"]) {
      fill(target, { ...fields, amountCents: value });
      await submit(target);
    }
    for (const value of [" ", "x".repeat(151)]) {
      fill(target, { ...fields, reference: value });
      await submit(target);
    }
    for (const key of ["evidenceReference", "reason"] as const)
      for (const value of [" ", "x".repeat(501)]) {
        fill(target, { ...fields, [key]: value });
        await submit(target);
      }
    expect(posts()).toHaveLength(0);
  });
  it("renders safe-integer cents exactly without floating point CAD rounding", async () => {
    await show();
    fill(form(), { ...fields, amountCents: "9007199254740990" });
    await submit(form());
    expect(posts()[0]![1].json.amountCents).toBe(9007199254740990);
    expect(host.textContent).toContain("CAD 90071992547409.90");
  });
  it.each([false, true])(
    "queries the original operation inside a direct retry before any POST (committed: %s)",
    async (committed) => {
      const original = admin.getMockImplementation()!;
      let attempts = 0;
      admin.mockImplementation(async (path, init) => {
        if (init?.method === "POST") {
          attempts++;
          if (committed || attempts > 1) rows = [doc(init.json)];
          if (attempts === 1) throw new TypeError("Lost response");
          return { ...meta, record: rows[0] };
        }
        if (path.includes("/by-operation/")) {
          if (!rows.length) throw new AdminApiError(404, "not_found", "No document");
          return { ...meta, record: rows[0] };
        }
        return original(path, init);
      });
      await show();
      fill(form());
      await submit(form());
      expect(host.querySelector('input[name="evidenceReference"]')).toBeNull();
      const beforeRetry = admin.mock.calls.length;
      await click("按原完整请求重试资料登记");
      expect(admin.mock.calls[beforeRetry]![0]).toBe(
        base + "/by-operation/" + posts()[0]![1].json.operationId,
      );
      expect(posts()).toHaveLength(committed ? 1 : 2);
      if (!committed) expect(posts()[1]![1].json).toEqual(posts()[0]![1].json);
      expect(host.textContent).toContain("资料已只读核对");
    },
  );
  it.each(["network", "mismatch", "permission", "cancel"] as const)(
    "does not retry POST when its mandatory lookup has %s failure",
    async (failure) => {
      const original = admin.getMockImplementation()!;
      admin.mockImplementation(async (path, init) => {
        if (init?.method === "POST") throw new TypeError("Lost response");
        if (path.includes("/by-operation/")) {
          if (failure === "mismatch")
            return { ...meta, record: { ...doc(posts()[0]![1].json), reason: "OTHER" } };
          if (failure === "permission") throw new AdminApiError(403, "forbidden", "Forbidden");
          if (failure === "cancel") throw new DOMException("Cancelled", "AbortError");
          throw new TypeError("Lookup unavailable");
        }
        return original(path, init);
      });
      await show();
      fill(form());
      await submit(form());
      await click("按原完整请求重试资料登记");
      expect(posts()).toHaveLength(1);
      expect(host.textContent).not.toContain("资料已只读核对");
      expect(host.textContent).not.toContain("OTHER");
    },
  );
  it.each(["session", "paused"] as const)(
    "rechecks %s between the mandatory 404 lookup and the original POST",
    async (change) => {
      const original = admin.getMockImplementation()!;
      let finish!: () => void;
      admin.mockImplementation(async (path, init) => {
        if (init?.method === "POST") throw new TypeError("Lost response");
        if (path.includes("/by-operation/"))
          return new Promise((_, reject) => {
            finish = () => reject(new AdminApiError(404, "not_found", "No document"));
          });
        return original(path, init);
      });
      await show();
      fill(form());
      await submit(form());
      await click("按原完整请求重试资料登记");
      if (change === "session") getToken.mockReturnValue("admin-b");
      else await show(supplier, true);
      await act(async () => finish());
      expect(posts()).toHaveLength(1);
    },
  );
  it("does not POST again after a successful registration whose follow-up GET failed", async () => {
    const original = admin.getMockImplementation()!;
    let readFails = true;
    admin.mockImplementation(async (path, init) => {
      if (path.includes("/by-operation/") && readFails) throw new TypeError("Read failed");
      return original(path, init);
    });
    await show();
    fill(form());
    await submit(form());
    expect(host.textContent).toContain("登记已确认，但只读核对失败");
    expect(host.textContent).not.toContain("按原完整请求重试资料登记");
    readFails = false;
    await click("只读查询原资料");
    expect(posts()).toHaveLength(1);
  });
  it.each([
    "supplierId",
    "operationId",
    "amountCents",
    "reference",
    "evidenceReference",
    "reason",
    "bankVerified",
    "settlementApplied",
  ] as const)("does not accept a mismatched %s in the follow-up read", async (field) => {
    const original = admin.getMockImplementation()!;
    admin.mockImplementation(async (path, init) => {
      const result = await original(path, init);
      if (path.includes("/by-operation/"))
        return {
          ...result,
          record: {
            ...result.record,
            [field]:
              field === "amountCents"
                ? 9999
                : field === "bankVerified" || field === "settlementApplied"
                  ? true
                  : "OTHER",
          },
        };
      return result;
    });
    await show();
    fill(form());
    await submit(form());
    await click("只读查询原资料");
    expect(host.textContent).not.toContain("OTHER");
    expect(host.textContent).not.toContain("资料已只读核对");
    expect(host.textContent).not.toContain("按原完整请求重试资料登记");
    expect(posts()).toHaveLength(1);
  });
  it("binds an ambiguous original intent to its token and hides its evidence after switching accounts", async () => {
    const original = admin.getMockImplementation()!;
    admin.mockImplementation(async (path, init) => {
      if (init?.method === "POST") throw new TypeError("Lost response");
      return original(path, init);
    });
    await show();
    fill(form());
    await submit(form());
    getToken.mockReturnValue("admin-b");
    await click("按原完整请求重试资料登记");
    expect(posts()).toHaveLength(1);
    expect(host.textContent).toContain("登录身份已变化");
    expect(host.textContent).not.toContain("TEST-EVIDENCE");
    expect(host.textContent).not.toContain("Synthetic TEST document only");
  });
  it("ignores late list results for another supplier and after unmount", async () => {
    let finish!: (value: unknown) => void;
    admin.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    await show();
    await show(other);
    await act(async () =>
      finish({
        ...meta,
        records: [
          doc({
            operationId: "old-op",
            amountCents: 1234,
            currency: "CAD",
            reference: "PRIVATE-A",
            evidenceReference: "PRIVATE-EVIDENCE",
            reason: "Private reason",
          }),
        ],
        page: 0,
        pageSize: 100,
        hasMore: false,
      }),
    );
    expect(host.textContent).not.toContain("PRIVATE-A");
    await act(async () => root.render(null));
    expect(host.textContent).toBe("");
  });
  it.each(["session", "unmount"] as const)(
    "blocks double submits and ignores a pending POST after %s",
    async (ending) => {
      const original = admin.getMockImplementation()!;
      let finish!: (value: unknown) => void;
      admin.mockImplementation(async (path, init) => {
        if (init?.method === "POST")
          return new Promise((resolve) => {
            finish = resolve;
          });
        return original(path, init);
      });
      await show();
      const target = form();
      fill(target);
      await act(async () => {
        target.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        target.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      if (ending === "session") getToken.mockReturnValue("admin-b");
      else await act(async () => root.render(null));
      await act(async () => finish({ ...meta, record: doc(posts()[0]![1].json) }));
      expect(posts()).toHaveLength(1);
      expect(admin.mock.calls.some(([path]) => path.includes("/by-operation/"))).toBe(false);
      expect(host.textContent).not.toContain("TEST-EVIDENCE");
      expect(host.textContent).not.toContain("recording-admin");
    },
  );
  it("can page through history while new registrations are paused", async () => {
    admin.mockImplementation(async (path) => ({
      ...meta,
      recordingEnabled: false,
      disabledReason: "paused",
      records: [],
      page: path.includes("page=1") ? 1 : 0,
      pageSize: 100,
      hasMore: !path.includes("page=1"),
    }));
    await show();
    await click("下一页资料");
    expect(admin).toHaveBeenCalledWith(
      base + "?page=1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(posts()).toHaveLength(0);
    expect(button("上一页资料").disabled).toBe(false);
  });
  it("hides old history when the active list request invalidates its session", async () => {
    rows = [
      doc({
        operationId: "old-operation",
        amountCents: 700,
        currency: "CAD",
        reference: "PRIVATE-REF",
        evidenceReference: "PRIVATE-EVIDENCE",
        reason: "Private TEST reason",
      }),
    ];
    await show();
    expect(host.textContent).toContain("PRIVATE-EVIDENCE");
    admin.mockImplementationOnce(async () => {
      getToken.mockReturnValue(null);
      throw new AdminApiError(401, "unauthorized", "Expired");
    });
    await click("刷新资料记录");
    expect(host.textContent).toContain("请先确认管理员登录");
    expect(host.textContent).not.toContain("PRIVATE-EVIDENCE");
    expect(host.textContent).not.toContain("正在读取资料");
  });
  it("allows distinct operations with the same reference and labels shared text as unresolved, not paid", async () => {
    const original = admin.getMockImplementation()!;
    admin.mockImplementation(async (path, init) => {
      const result = await original(path, init);
      if (result.record) {
        result.record = { ...result.record, referenceShared: true };
        rows = [result.record];
      }
      return result;
    });
    await show();
    fill(form());
    await submit(form());
    await click("登记另一条资料");
    fill(form());
    await submit(form());
    expect(posts()).toHaveLength(2);
    expect(posts()[1]![1].json.operationId).not.toBe(posts()[0]![1].json.operationId);
    expect(posts()[1]![1].json.reference).toBe(posts()[0]![1].json.reference);
    expect(host.textContent).toContain("相同参考文本");
    expect(host.textContent).not.toContain("已结清");
  });
});

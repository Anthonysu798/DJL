import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
}));
import { setToken } from "@/lib/api";
import { SupplierAccess } from "./SupplierAccess";

const suppliers = [
  { id: "supplier-a", name: "Supplier A", active: true },
  { id: "supplier-b", name: "Supplier B", active: false },
];
let host: HTMLDivElement, root: Root;
const onUpdated = vi.fn(async () => {});
const list = (index = 0, members = [{ userId: "member/a" }], page = 0, hasMore = false) => ({
  supplier: suppliers[index],
  members,
  page,
  hasMore,
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  admin.mockReset();
  onUpdated.mockReset();
  onUpdated.mockResolvedValue(undefined);
  admin.mockResolvedValue(list());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  setToken(null);
  host.remove();
  vi.unstubAllGlobals();
});
const show = async (disabled = false) => {
  await act(async () =>
    root.render(<SupplierAccess suppliers={suppliers} disabled={disabled} onUpdated={onUpdated} />),
  );
};
const select = async (id = "supplier-a") => {
  const element = host.querySelector<HTMLSelectElement>('select[aria-label="管理供应商权限"]')!;
  expect(element).not.toBeNull();
  await act(async () => {
    element.value = id;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const button = (label: string) => {
  const element = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label,
  );
  if (!element) throw new Error(`Missing button ${label}`);
  return element;
};
const click = async (label: string) => {
  await act(async () => button(label).click());
};
const submit = async (label: string, reason: string) => {
  const form = host.querySelector<HTMLFormElement>(`form[aria-label="${label}"]`)!;
  expect(form).not.toBeNull();
  const input = form.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
  await act(async () => {
    input.value = reason;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("supplier permission lifecycle without deleting financial history", () => {
  it("reads only member IDs with server pagination, resets supplier scope and states the stop boundary", async () => {
    admin.mockImplementation(async (path: string) =>
      path.includes("supplier-b")
        ? list(1, [{ userId: "member-b" }])
        : path.endsWith("page=1")
          ? list(0, [{ userId: "member-next" }], 1)
          : list(0, [{ userId: "member/a" }], 0, true),
    );
    await show();
    expect(admin).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("当前页没有已授权成员");
    await select();
    expect(admin).toHaveBeenLastCalledWith("/commerce/suppliers/supplier-a/members?page=0");
    expect(host.textContent).toContain("member/a");
    expect(host.textContent).toContain("不会自动取消既有订单或退款");
    expect(host.textContent).toContain("历史及财务记录不删除");
    await click("下一页成员");
    expect(admin).toHaveBeenLastCalledWith("/commerce/suppliers/supplier-a/members?page=1");
    expect(host.textContent).toContain("member-next");
    expect(host.textContent).not.toContain("member/a");
    await click("上一页成员");
    await select("supplier-b");
    expect(admin).toHaveBeenLastCalledWith("/commerce/suppliers/supplier-b/members?page=0");
    expect(host.textContent).toContain("member-b");
    expect(host.textContent).not.toContain("member/a");
    expect(host.textContent).toContain("第 1 页");
  });
  it("does not report a failed read as an empty membership list and retries only a read", async () => {
    admin.mockRejectedValueOnce(new TypeError("Offline")).mockResolvedValue(list(0, []));
    await show();
    await select();
    expect(host.textContent).toContain("成员列表尚未读取成功，不能据此判断没有成员");
    expect(host.textContent).not.toContain("当前页没有已授权成员");
    await click("刷新成员与状态");
    expect(host.textContent).toContain("当前页没有已授权成员");
    expect(admin.mock.calls.every((call) => call.length === 1)).toBe(true);
  });
  it("ignores a late previous supplier response instead of mixing its member IDs", async () => {
    let finish!: (value: ReturnType<typeof list>) => void;
    admin.mockImplementation((path: string) =>
      path.includes("supplier-a")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(list(1, [{ userId: "member-b" }])),
    );
    await show();
    await select();
    await select("supplier-b");
    await act(async () => finish(list(0, [{ userId: "late-member-a" }])));
    expect(host.textContent).toContain("member-b");
    expect(host.textContent).not.toContain("late-member-a");
  });
  it("does not let an old supplier read failure clear the new supplier's confirmed list", async () => {
    let reject!: (cause: unknown) => void;
    admin.mockImplementation((path: string) =>
      path.includes("supplier-a")
        ? new Promise((_resolve, fail) => {
            reject = fail;
          })
        : Promise.resolve(list(1, [{ userId: "member-b" }])),
    );
    await show();
    await select();
    await select("supplier-b");
    await act(async () => reject(new TypeError("Old request failed")));
    expect(host.textContent).toContain("member-b");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it.each(["   ", "a".repeat(501)])(
    "rejects invalid revocation reasons before submitting (%s)",
    async (reason) => {
      await show();
      await select();
      await submit("撤销成员 member/a", reason);
      expect(admin.mock.calls.filter((call) => call[1])).toHaveLength(0);
      expect(host.textContent).toContain("原因须为去除首尾空白后的 1–500 个字符");
    },
  );
  it("revokes the selected user with a trimmed mandatory reason and refreshes server data", async () => {
    admin.mockImplementation(async (_path: string, options?: unknown) =>
      options ? { ok: true } : admin.mock.calls.some((call) => call[1]) ? list(0, []) : list(),
    );
    await show();
    await select();
    await submit("撤销成员 member/a", "  Supplier access ended  ");
    expect(admin).toHaveBeenCalledWith("/commerce/suppliers/supplier-a/members/member%2Fa/revoke", {
      method: "POST",
      json: { reason: "Supplier access ended" },
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("当前页没有已授权成员");
    expect(host.textContent).not.toContain("member/a");
  });
  it("drops the deferred mutation readback after the administrator session changes", async () => {
    setToken("first-test-session");
    let finish!: (result: { ok: true }) => void;
    admin.mockImplementation((_path, init) =>
      init
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(list()),
    );
    await show();
    await select();
    await submit("撤销成员 member/a", "Synthetic revocation");
    setToken("replacement-test-session");
    const count = admin.mock.calls.length;
    await act(async () => finish({ ok: true }));
    expect(admin.mock.calls).toHaveLength(count);
    expect(onUpdated).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("变更及最新成员状态已由服务器确认");
  });
  it("changes supplier status explicitly with a reason, without restoring revoked membership", async () => {
    let active = true;
    admin.mockImplementation(async (_path: string, options?: { json: { active: boolean } }) => {
      if (options) {
        active = options.json.active;
        return { ok: true };
      }
      return { ...list(0, []), supplier: { ...suppliers[0], active } };
    });
    await show();
    await select();
    await submit("供应商状态变更", " ");
    expect(admin.mock.calls.filter((call) => call[1])).toHaveLength(0);
    await submit("供应商状态变更", "a".repeat(501));
    expect(admin.mock.calls.filter((call) => call[1])).toHaveLength(0);
    await submit("供应商状态变更", "  Supply paused  ");
    expect(admin).toHaveBeenCalledWith("/commerce/suppliers/supplier-a/status", {
      method: "POST",
      json: { active: false, reason: "Supply paused" },
    });
    expect(button("恢复供应商").disabled).toBe(false);
    await submit("供应商状态变更", "Reviewed resume");
    expect(admin).toHaveBeenCalledWith("/commerce/suppliers/supplier-a/status", {
      method: "POST",
      json: { active: true, reason: "Reviewed resume" },
    });
    expect(host.textContent).toContain("恢复供应商不会恢复已撤销的成员授权");
    expect(host.textContent).toContain("当前页没有已授权成员");
    expect(onUpdated).toHaveBeenCalledTimes(2);
  });
  it("blocks blind mutation retries after an unknown result until a successful server refresh", async () => {
    admin.mockImplementation(async (_path: string, options?: unknown) => {
      if (options) throw new TypeError("Offline");
      return list();
    });
    await show();
    await select();
    await submit("撤销成员 member/a", "Verified revocation");
    expect(host.textContent).toContain("操作结果尚未确认，请先刷新成员与状态核对；不会自动重试");
    expect(host.querySelector('form[aria-label="撤销成员 member/a"]')).toBeNull();
    expect(admin.mock.calls.filter((call) => call[1])).toHaveLength(1);
    await click("刷新成员与状态");
    expect(host.querySelector('form[aria-label="撤销成员 member/a"]')).not.toBeNull();
    expect(admin.mock.calls.filter((call) => call[1])).toHaveLength(1);
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });
  it("keeps an acknowledged command distinct from a failed parent refresh without resubmitting it", async () => {
    admin.mockImplementation(async (_path: string, options?: unknown) =>
      options ? { ok: true } : list(),
    );
    onUpdated.mockRejectedValueOnce(new TypeError("Parent refresh failed"));
    await show();
    await select();
    await submit("供应商状态变更", "Stop after review");
    expect(host.textContent).toContain("变更请求已由服务器确认，最新状态或关联页面尚未刷新");
    expect(host.textContent).not.toContain("变更及最新成员状态已由服务器确认");
    expect(host.querySelector('form[aria-label="供应商状态变更"]')).toBeNull();
    await click("刷新成员与状态");
    expect(admin.mock.calls.filter((call) => call[1])).toHaveLength(1);
    expect(onUpdated).toHaveBeenCalledTimes(2);
    expect(host.querySelector('form[aria-label="供应商状态变更"]')).not.toBeNull();
  });
  it("does not attach a prior mounted supplier's late mutation result to a new supplier scope", async () => {
    let finish!: (value: { ok: true }) => void;
    admin.mockImplementation((path: string, options?: unknown) =>
      options
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(path.includes("supplier-b") ? list(1, [{ userId: "member-b" }]) : list()),
    );
    await show();
    await select();
    await submit("供应商状态变更", "Stop supplier A");
    await act(async () =>
      root.render(
        <SupplierAccess
          key="new-scope"
          suppliers={suppliers}
          disabled={false}
          onUpdated={onUpdated}
        />,
      ),
    );
    await select("supplier-b");
    await act(async () => finish({ ok: true }));
    expect(host.textContent).toContain("member-b");
    expect(host.textContent).not.toContain("变更及最新成员状态已由服务器确认");
    expect(onUpdated).not.toHaveBeenCalled();
    expect(admin.mock.calls.filter((call) => call[1])).toHaveLength(1);
  });
  it("keeps an unknown mutation locked when its verification read also fails", async () => {
    await show();
    await select();
    admin.mockRejectedValue(new TypeError("Offline"));
    await submit("供应商状态变更", "Reviewed stop");
    await click("刷新成员与状态");
    expect(host.textContent).toContain("操作结果尚未确认");
    expect(host.textContent).toContain("成员列表尚未读取成功");
    expect(host.querySelector('form[aria-label="供应商状态变更"]')).toBeNull();
    expect(host.textContent).not.toContain("当前页没有已授权成员");
    expect(admin.mock.calls.filter((call) => call[1])).toHaveLength(1);
  });
  it("honors the parent's disabled flag without issuing authorization actions", async () => {
    await show(true);
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="管理供应商权限"]')!.disabled,
    ).toBe(true);
    await select();
    expect(admin).not.toHaveBeenCalled();
  });
});

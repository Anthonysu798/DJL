import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/api", () => ({ admin }));
vi.mock("@/components/Shell", () => ({
  Shell: ({ actions, children }: { actions?: ReactNode; children: ReactNode }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: "shop-member" }),
}));

import TeamMemberPage from "./[id]/page";
import TeamPage from "./page";

const member = {
  status: "active",
  emailVerifiedAt: null,
  totpEnabled: true,
  lastLoginAt: null,
  lastLoginIp: null,
  createdAt: "2026-11-05T00:00:00Z",
};
const shop = {
  ...member,
  id: "shop-member",
  name: "Synthetic shop member",
  email: "shop-staff@test.invalid",
  role: "commerce",
  commerceRole: "finance",
};
const support = {
  ...member,
  id: "platform-member",
  name: "Synthetic platform member",
  email: "platform-staff@test.invalid",
  role: "employee",
};
let root: Root;
let host: HTMLDivElement;
let shopRole: string;
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("PointerEvent", window.PointerEvent ?? MouseEvent);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  shopRole = "finance";
  admin.mockReset();
  admin.mockImplementation(
    async (route: string, options?: { method: string; json?: { commerceRole?: string } }) => {
      if (options?.method === "PATCH" && route === "/admins/shop-member") {
        shopRole = options.json?.commerceRole ?? shopRole;
        return {};
      }
      if (options) return {};
      if (route === "/me") return { admin: { id: "owner" } };
      if (route === "/admins") return [{ ...shop, commerceRole: shopRole }, support];
      return [];
    },
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (scrollIntoView)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function show(Page = TeamPage) {
  await act(async () => root.render(<Page />));
}

function byText<T extends HTMLElement>(selector: string, label: string): T {
  const element = [...document.querySelectorAll<T>(selector)].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(element, `${label} exists in ${selector}`).toBeDefined();
  return element!;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function press(element: Element, key: string) {
  await act(async () =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );
}

async function change(id: string, value: string) {
  const input = document.getElementById(id);
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openRoles() {
  const role = document.querySelector('[role="dialog"] [role="combobox"]');
  expect(role).not.toBeNull();
  await press(role!, "ArrowDown");
  return [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
}

async function selectRole(label: string) {
  await press(byText('[role="option"]', label), "Enter");
}

async function edit(email: string) {
  const menu = document.querySelector(`button[aria-label="Actions for ${email}"]`);
  expect(menu).not.toBeNull();
  await press(menu!, "ArrowDown");
  await click(byText('[role="menuitem"]', "Edit name and role"));
}

it.each([
  ["Commerce · Operations", "operations"],
  ["Commerce · Support", "support"],
  ["Commerce · Finance", "finance"],
  ["Commerce · Read-only", "read_only"],
])("invites %s with an explicit commerce account scope", async (label, commerceRole) => {
  await show();
  await click(byText("button", "Invite member"));
  const options = await openRoles();
  expect(options).toContain(label);
  expect(options).not.toContain("Revoke commerce access");
  await selectRole(label);
  await change("f-name", "Synthetic invite");
  await change("f-email", "synthetic-invite@test.invalid");
  await click(byText("button", "Send invite"));
  expect(admin).not.toHaveBeenCalledWith("/admins", expect.any(Object));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Reason");
  await change("reason", "Approved commerce assignment");
  await click(byText("button", "Send invite"));
  expect(admin).toHaveBeenCalledWith("/admins", {
    method: "POST",
    json: {
      name: "Synthetic invite",
      email: "synthetic-invite@test.invalid",
      role: "commerce",
      commerceRole,
      reason: "Approved commerce assignment",
    },
  });
});

it("revokes commerce access without converting the account to a legacy platform role", async () => {
  await show();
  expect(host.textContent).toContain("Commerce · Finance");
  await edit(shop.email);
  expect(await openRoles()).toEqual([
    "Commerce · Operations",
    "Commerce · Support",
    "Commerce · Finance",
    "Commerce · Read-only",
    "Revoke commerce access",
  ]);
  await selectRole("Revoke commerce access");
  await change("reason", "Assignment ended");
  await click(byText("button", "Save"));
  expect(admin).toHaveBeenCalledWith("/admins/shop-member", {
    method: "PATCH",
    json: { name: shop.name, commerceRole: "none", reason: "Assignment ended" },
  });
  expect(host.textContent).toContain("Commerce · No access");
});

it("preserves the existing platform role selector and platform edit request", async () => {
  await show();
  await edit(support.email);
  expect(await openRoles()).toEqual(["Employee · support desk", "Admin · full access"]);
  await selectRole("Admin · full access");
  await change("reason", "Approved platform assignment");
  await click(byText("button", "Save"));
  expect(admin).toHaveBeenCalledWith("/admins/platform-member", {
    method: "PATCH",
    json: { name: support.name, role: "admin", reason: "Approved platform assignment" },
  });
});

it("shows a revoked member as commerce-only on the team profile", async () => {
  shopRole = "none";
  await show(TeamMemberPage);
  expect(host.textContent).toContain("Commerce · No access");
  expect(host.textContent).not.toContain("Employee");
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { admin, pathname, push, replace } = vi.hoisted(() => ({
  admin: vi.fn(),
  pathname: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => {
  const router = { push, replace };
  return { useRouter: () => router, usePathname: pathname };
});
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: ({ open }: { open: boolean }) => <div data-testid="palette">{String(open)}</div>,
}));
import { Shell } from "@/components/Shell";
import { setToken } from "@/lib/api";

const email = "staff@example.invalid";
let host: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <Shell title="Page title" actions={<button type="button">Page action</button>}>
        <p>Protected content</p>
      </Shell>,
    );
  });
}

function identity(role: "admin" | "employee" | "commerce", mfaVerified = true) {
  return { admin: { id: "staff", email, role, mfaVerified } };
}

function links() {
  return Array.from(host.querySelectorAll("a"), (link) => link.getAttribute("href"));
}

describe("staff console shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admin.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setToken("test-admin-token");
    pathname.mockReturnValue("/commerce");
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

  it("renders no platform navigation, controls or content before identity is known", async () => {
    let resolve!: (profile: ReturnType<typeof identity>) => void;
    admin.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await render();
    expect(links()).toEqual([]);
    expect(host.textContent).not.toContain("Search anything");
    expect(host.textContent).not.toContain("Page action");
    expect(host.textContent).not.toContain("Protected content");
    await act(async () => resolve(identity("commerce")));
    expect(host.textContent).toContain("Protected content");
  });

  it("shows only Commerce and cannot open platform search or activity as commerce staff", async () => {
    admin.mockResolvedValueOnce(identity("commerce"));
    await render();
    expect(links()).toEqual(["/commerce", "/commerce"]);
    expect(host.textContent).toContain("Protected content");
    expect(host.textContent).not.toContain("Search anything");
    expect(host.querySelector("[aria-label='Recent activity']")).toBeNull();
    expect(host.querySelector("[data-testid='palette']")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }));
    });
    expect(host.querySelector("[data-testid='palette']")).toBeNull();
    expect(admin.mock.calls).toEqual([["/me"]]);
  });

  it.each(["/", "/users/other", "/commerce-looking-platform"])(
    "redirects verified commerce staff from %s before rendering the page",
    async (path) => {
      pathname.mockReturnValue(path);
      admin.mockResolvedValueOnce(identity("commerce"));
      await render();
      expect(replace).toHaveBeenCalledWith("/commerce");
      expect(host.textContent).not.toContain("Page title");
      expect(host.textContent).not.toContain("Page action");
      expect(host.textContent).not.toContain("Protected content");
      expect(links()).toEqual([]);
    },
  );

  it("redirects incomplete MFA to login rather than the commerce landing page", async () => {
    admin.mockResolvedValueOnce(identity("commerce", false));
    await render();
    expect(replace.mock.calls).toEqual([["/login?step=totp"]]);
    expect(links()).toEqual([]);
    expect(host.textContent).not.toContain("Protected content");
  });

  it("drops privileged controls on a session change before resolving the new profile", async () => {
    admin.mockResolvedValueOnce(identity("admin"));
    await render();
    expect(host.textContent).toContain("Search anything");

    let resolve!: (profile: ReturnType<typeof identity>) => void;
    admin.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await act(async () => setToken("different-test-admin-token"));
    expect(links()).toEqual([]);
    expect(host.textContent).not.toContain("Search anything");
    await act(async () => resolve(identity("commerce")));
    expect(links()).toEqual(["/commerce", "/commerce"]);

    await act(async () => setToken(null));
    expect(replace).toHaveBeenCalledWith("/login");
    expect(host.textContent).not.toContain("Protected content");
    expect(admin.mock.calls).toEqual([["/me"], ["/me"]]);
  });

  it("does not apply an older profile received after the new commerce session", async () => {
    let resolveOld!: (profile: ReturnType<typeof identity>) => void;
    admin
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce(identity("commerce"));
    await render();
    await act(async () => setToken("different-test-admin-token"));
    expect(links()).toEqual(["/commerce", "/commerce"]);
    await act(async () => resolveOld(identity("admin")));
    expect(links()).toEqual(["/commerce", "/commerce"]);
    expect(host.textContent).not.toContain("Search anything");
  });

  it("lets commerce staff sign out and returns to login once", async () => {
    admin.mockResolvedValueOnce(identity("commerce")).mockResolvedValueOnce({ ok: true });
    await render();
    const button = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Log out"),
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(admin.mock.calls).toEqual([["/me"], ["/auth/logout", { method: "POST", json: {} }]]);
    expect(replace.mock.calls).toEqual([["/login"]]);
    expect(host.textContent).not.toContain("Protected content");
  });

  it.each(["admin", "employee"] as const)(
    "preserves platform chrome and command palette for %s",
    async (role) => {
      pathname.mockReturnValue("/users");
      admin.mockResolvedValueOnce(identity(role));
      await render();
      expect(replace).not.toHaveBeenCalled();
      expect(links()).toContain("/users");
      expect(links()).toContain("/audit");
      expect(links().includes("/commerce")).toBe(role === "admin");
      expect(host.textContent).toContain("Search anything");
      expect(host.querySelector("[aria-label='Recent activity']")).not.toBeNull();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }));
      });
      expect(host.querySelector("[data-testid='palette']")?.textContent).toBe("true");
      expect(host.textContent).toContain("Protected content");
    },
  );
});

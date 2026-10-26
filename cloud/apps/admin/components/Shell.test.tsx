import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/", replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => route,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ priority: _, ...props }: React.ComponentProps<"img"> & { priority?: boolean }) => (
    <img {...props} />
  ),
}));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));

import { AdminLayout, Shell } from "./Shell";
import { admin, setToken } from "@/lib/api";
import { LocaleProvider } from "./LocaleProvider";

beforeEach(() => {
  route.pathname = "/";
  route.replace.mockClear();
  setToken("test-session");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          admin: { id: "fixture", email: "admin@example.test", role: "admin", mfaVerified: true },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  setToken(null);
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("persistent admin navigation", () => {
  it("localizes navigation without fetching the verified account again", async () => {
    localStorage.setItem("djl_admin_locale", "zh-Hans");
    const view = render(
      <LocaleProvider>
        <AdminLayout>
          <Shell>Content</Shell>
        </AdminLayout>
      </LocaleProvider>,
    );
    await screen.findByRole("link", { name: "模型" });
    const calls = vi.mocked(fetch).mock.calls.length;
    const sidebar = screen.getByRole("complementary");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fr" } });
    await screen.findByRole("link", { name: "Modèles" });
    expect(screen.getByRole("complementary")).toBe(sidebar);
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    view.unmount();
  });
  it("keeps the same sidebar and verified account across page navigation", async () => {
    const view = render(
      <AdminLayout>
        <Shell title="Dashboard">Overview</Shell>
      </AdminLayout>,
    );
    await screen.findByRole("link", { name: "Models" });
    const sidebar = screen.getByRole("complementary", { name: "Admin navigation" });
    const calls = vi.mocked(fetch).mock.calls.length;
    route.pathname = "/models";
    view.rerender(
      <AdminLayout>
        <Shell title="Model catalog">Catalog</Shell>
      </AdminLayout>,
    );
    expect(screen.getByRole("complementary", { name: "Admin navigation" })).toBe(sidebar);
    expect(screen.getByRole("link", { name: "Models" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("Loading admin…")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  });

  it("redirects an expired session and removes protected page content", async () => {
    render(
      <AdminLayout>
        <Shell title="Dashboard">Protected content</Shell>
      </AdminLayout>,
    );
    await screen.findByText("Protected content");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await act(async () => {
      await admin("/models").catch(() => undefined);
    });
    expect(route.replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("Protected content")).toBeNull();
  });

  it("requires MFA before mounting a protected page", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          admin: { id: "fixture", email: "admin@example.test", role: "admin", mfaVerified: false },
        }),
      ),
    );
    render(
      <AdminLayout>
        <Shell>Protected content</Shell>
      </AdminLayout>,
    );
    await waitFor(() => expect(route.replace).toHaveBeenCalledWith("/login?step=totp"));
    expect(screen.queryByText("Protected content")).toBeNull();
  });

  it("keeps public sign-in outside the dashboard frame", () => {
    route.pathname = "/login";
    render(<AdminLayout>Sign-in form</AdminLayout>);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("closes mobile navigation after selecting another route", async () => {
    const view = render(
      <AdminLayout>
        <Shell>Overview</Shell>
      </AdminLayout>,
    );
    await screen.findByRole("link", { name: "Models" });
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(
      screen.getByRole("button", { name: "Open navigation" }).getAttribute("aria-expanded"),
    ).toBe("true");
    route.pathname = "/models";
    view.rerender(
      <AdminLayout>
        <Shell>Catalog</Shell>
      </AdminLayout>,
    );
    expect(
      screen.getByRole("button", { name: "Open navigation" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { admin, replace, params, setToken } = vi.hoisted(() => ({
  admin: vi.fn(),
  replace: vi.fn(),
  params: vi.fn(),
  setToken: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: params,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
  setToken,
}));
vi.mock("@/lib/client", () => ({ loginClient: () => ({}) }));
import { AdminApiError } from "@/lib/api";
import LoginPage from "./page";

const email = "staff@example.invalid";
const auth = { secret: "SYNTHETIC-TEST-SECRET", uri: "otpauth://totp/test" };
let root: Root;
let host: HTMLDivElement;

async function render() {
  await act(async () => root.render(<LoginPage />));
}

async function fill(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`);
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function identity(role: "admin" | "employee" | "commerce", mfaVerified: boolean) {
  return { admin: { id: "staff", email, role, mfaVerified } };
}

describe("admin sign-in landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admin.mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    params.mockReturnValue(new URLSearchParams());
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    ["admin", "/"],
    ["employee", "/"],
    ["commerce", "/commerce"],
  ] as const)("lands a verified %s identity at %s", async (role, home) => {
    admin.mockResolvedValueOnce({ ...identity(role, true), token: "test-admin-token" });
    await render();
    await fill("email", email);
    await fill("password", "synthetic-test-password");
    await submit();
    expect(setToken).toHaveBeenCalledWith("test-admin-token");
    expect(replace.mock.calls).toEqual([[home]]);
  });

  it("does not land a commerce user until their initial MFA enrollment is confirmed", async () => {
    admin
      .mockResolvedValueOnce({ ...identity("commerce", false), token: "test-admin-token" })
      .mockResolvedValueOnce(auth)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(identity("commerce", true));
    await render();
    await fill("email", email);
    await fill("password", "synthetic-test-password");
    await submit();
    expect(replace).not.toHaveBeenCalled();
    await fill("code", "123456");
    await submit();
    expect(replace.mock.calls).toEqual([["/commerce"]]);
    expect(admin.mock.calls.map(([route]) => route)).toEqual([
      "/auth/login",
      "/auth/totp/enroll",
      "/auth/totp/confirm",
      "/me",
    ]);
  });

  it("prompts an enrolled commerce user for their code before routing", async () => {
    admin
      .mockRejectedValueOnce(new AdminApiError(400, "totp_required", "A code is required."))
      .mockResolvedValueOnce({ ...identity("commerce", true), token: "test-admin-token" });
    await render();
    await fill("email", email);
    await fill("password", "synthetic-test-password");
    await submit();
    expect(setToken).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await fill("totp", "123456");
    await submit();
    expect(admin).toHaveBeenLastCalledWith(
      "/auth/login",
      expect.objectContaining({ json: expect.objectContaining({ totp: "123456" }) }),
    );
    expect(replace.mock.calls).toEqual([["/commerce"]]);
  });

  it("retries the profile after enrollment without re-submitting the code or mislabeling the failure", async () => {
    params.mockReturnValue(new URLSearchParams("step=totp"));
    admin
      .mockResolvedValueOnce(auth)
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("profile unavailable"))
      .mockResolvedValueOnce(identity("commerce", true));
    await render();
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "Generate secret")!
        .click();
    });
    await fill("code", "123456");
    await submit();
    expect(replace).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Authenticator confirmed");
    expect(host.textContent).not.toContain("code is wrong");
    expect(host.querySelector("#code")).toBeNull();
    await submit();
    expect(replace.mock.calls).toEqual([["/commerce"]]);
    expect(admin.mock.calls.map(([route]) => route)).toEqual([
      "/auth/totp/enroll",
      "/auth/totp/confirm",
      "/me",
      "/me",
    ]);
  });

  it("keeps the code field available for an authenticator code rejection", async () => {
    admin
      .mockResolvedValueOnce({ ...identity("commerce", false), token: "test-admin-token" })
      .mockResolvedValueOnce(auth)
      .mockRejectedValueOnce(new AdminApiError(400, "bad_totp", "Authenticator code is wrong."));
    await render();
    await fill("email", email);
    await fill("password", "synthetic-test-password");
    await submit();
    await fill("code", "123456");
    await submit();
    expect(replace).not.toHaveBeenCalled();
    expect(host.textContent).toContain("code is wrong");
    expect(host.querySelector("#code")).not.toBeNull();
    expect(admin.mock.calls.some(([route]) => route === "/me")).toBe(false);
  });
});

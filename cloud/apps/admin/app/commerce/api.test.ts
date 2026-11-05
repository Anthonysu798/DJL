import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin, AdminApiError, getToken, setToken } from "@/lib/api";

const expired = () =>
  Response.json(
    { error: { code: "unauthorized", message: "Expired test session" } },
    { status: 401 },
  );
beforeEach(() => {
  setToken("admin-a");
});
afterEach(() => {
  setToken(null);
  vi.unstubAllGlobals();
});
describe("admin API unauthorized response account scope", () => {
  it("does not clear a newer account when an old request returns401", async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((done) => {
          finish = done;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = admin("/me");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer admin-a",
    );
    setToken("admin-b");
    finish(expired());
    await expect(pending).rejects.toBeInstanceOf(AdminApiError);
    expect(getToken()).toBe("admin-b");
    expect(sessionStorage.getItem("djl_admin_token")).toBe("admin-b");
  });
  it("still clears the current account when its own request returns401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => expired()),
    );
    await expect(admin("/me")).rejects.toBeInstanceOf(AdminApiError);
    expect(getToken()).toBeNull();
    expect(sessionStorage.getItem("djl_admin_token")).toBeNull();
  });
  it("does not clear a later login when a request began without a bearer token", async () => {
    setToken(null);
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            finish = done;
          }),
      ),
    );
    const pending = admin("/me");
    setToken("admin-b");
    finish(expired());
    await expect(pending).rejects.toBeInstanceOf(AdminApiError);
    expect(getToken()).toBe("admin-b");
  });
});

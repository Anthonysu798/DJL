import { expect, it, vi } from "vitest";
import { createCommerceCsrf, isScopedCommercePath } from "./commerceCsrf.ts";

const origin = "https://127.0.0.1:48981";
const headers = (session: string, token?: string, from = origin) =>
  new Headers({
    origin: from,
    "x-fixture-shop-session": session,
    ...(token ? { "x-csrf-token": token } : {}),
  });
const fixture = () => {
  const buyer = vi.fn(async (headers: Headers) => {
    const sessionId = headers.get("x-fixture-shop-session");
    return !sessionId || headers.has("authorization")
      ? null
      : {
          id: "buyer",
          email: "synthetic@example.invalid",
          emailVerified: true as const,
          sessionId,
        };
  });
  const csrf = createCommerceCsrf({ buyer }, origin, "synthetic-fixture-secret");
  return { buyer, csrf, headers };
};

it("requires exact origin even for token issuance and private reads", async () => {
  const { buyer, csrf, headers } = fixture();
  await expect(csrf.issue(new Headers())).rejects.toMatchObject({
    status: 403,
    code: "csrf_origin",
  });
  await expect(
    csrf.resolve(headers("a", undefined, "https://127.0.0.1:48982"), false),
  ).rejects.toMatchObject({ status: 403 });
  expect(buyer).not.toHaveBeenCalled();
  await expect(csrf.issue(headers(""))).rejects.toMatchObject({ status: 401 });
});

it("rejects missing, malformed, duplicate and other-session tokens before a write", async () => {
  const { csrf, headers } = fixture();
  const { token } = await csrf.issue(headers("first"));
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await csrf.issue(headers("replacement"))).token !== token).toBe(true);
  for (const value of [undefined, "x", `${token}, ${token}`, "a".repeat(43)])
    await expect(csrf.resolve(headers("first", value), true)).rejects.toMatchObject({
      status: 403,
      code: "csrf_token",
    });
  await expect(csrf.resolve(headers("replacement", token), true)).rejects.toMatchObject({
    status: 403,
    code: "csrf_token",
  });
  const explicit = headers("first", token);
  explicit.set("authorization", "Bearer synthetic");
  await expect(csrf.resolve(explicit, true)).rejects.toMatchObject({ status: 401 });
  await expect(csrf.resolve(headers("first", token), true)).resolves.toMatchObject({ id: "buyer" });
});

it("does not recognize existing AI, auth, files or commerce paths as scoped", () => {
  for (const path of [
    "/v1/auth/sign-out",
    "/v1/commerce/orders",
    "/v1/files",
    "/v1/shop/authenticate",
    "/v1/shop/commerce-other/orders",
  ])
    expect(isScopedCommercePath(path)).toBe(false);
  expect(isScopedCommercePath("/v1/shop/auth/sign-in/email")).toBe(true);
  expect(isScopedCommercePath("/v1/shop/commerce/orders")).toBe(true);
});

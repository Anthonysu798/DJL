import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

afterEach(() => vi.unstubAllGlobals());

it("refreshes a cached signed-out session after email verification before redirecting", async () => {
  let signedIn = false;
  const user = {
    id: "qa-user",
    name: "QA",
    email: "qa@test.invalid",
    emailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const session = {
    id: "qa-session",
    token: "qa-only-token",
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/email-otp/verify-email")) {
      signedIn = true;
      return Response.json({ status: true, token: session.token, user });
    }
    return Response.json(signedIn ? { session, user } : null);
  });
  const { authClient } = await import("@/lib/auth-client");
  const { AuthGate } = await import("./AuthGate");
  const content = (
    <AuthGate next="/chat">
      <p>Conversation ready</p>
    </AuthGate>
  );
  const initial = render(content);
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Fchat"));
  initial.unmount();
  // Better Auth keeps its session subscriber alive briefly after unmount.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await act(() => authClient.emailOtp.verifyEmail({ email: user.email, otp: "123456" }));
  replace.mockClear();
  render(content);
  await screen.findByText("Conversation ready");
  expect(replace).not.toHaveBeenCalled();
});

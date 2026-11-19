import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SiteFrame } from "@/components/SiteFrame";
import { LocaleProvider } from "@/lib/locale-context";
import VerifyPage from "./page";

const { push, verifyEmail, sendVerificationOtp } = vi.hoisted(() => ({
  push: vi.fn(),
  verifyEmail: vi.fn(),
  sendVerificationOtp: vi.fn(),
}));
const email = "buyer@test.invalid";
let pathname = "/verify";
let params = new URLSearchParams({ email });

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
  useSearchParams: () => params,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { emailOtp: { verifyEmail, sendVerificationOtp } },
}));

const frame = (
  <LocaleProvider locale="en">
    <SiteFrame>
      <VerifyPage />
    </SiteFrame>
  </LocaleProvider>
);
const hosted = () =>
  Object.defineProperty(window, "djlCommerce", {
    configurable: true,
    value: { kind: "desktop", openCheckout: vi.fn() },
  });
const submitCode = () => {
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: "012345" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
};

beforeEach(() => {
  pathname = "/verify";
  params = new URLSearchParams({ email });
  push.mockReset();
  verifyEmail.mockReset().mockResolvedValue({
    data: { status: true, user: { email } },
    error: null,
  });
  sendVerificationOtp.mockReset().mockResolvedValue({ data: { success: true }, error: null });
});
afterEach(() => {
  Reflect.deleteProperty(window, "djlCommerce");
});

it("does not expose a chat link before hydration and lets hosted verification return to the shop", async () => {
  hosted();
  expect(renderToString(frame)).not.toContain('href="/chat"');
  render(frame);
  expect(await screen.findByRole("link", { name: "DJL Cloud" })).toHaveAttribute("href", "/shop");
  expect(screen.getByRole("heading", { name: "Check your email" })).toBeInTheDocument();
});

it("preserves ordinary verification's chat brand and default return", async () => {
  render(frame);
  expect(await screen.findByRole("link", { name: "DJL Cloud" })).toHaveAttribute("href", "/chat");
  submitCode();
  await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith("/chat"));
});

it("keeps other site-frame routes unchanged even if the hosted bridge exists", () => {
  hosted();
  pathname = "/account";
  expect(renderToString(frame)).toContain('href="/chat"');
  render(frame);
  expect(screen.getByRole("link", { name: "DJL Cloud" })).toHaveAttribute("href", "/chat");
});

it("keeps the original shop destination across an explicit resend and successful verification", async () => {
  hosted();
  const next = "/shop?ref=TEST-REF&category=Home+Office#favorites";
  params.set("next", next);
  render(frame);
  expect(sendVerificationOtp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
  expect(sendVerificationOtp).toHaveBeenCalledExactlyOnceWith({
    email,
    type: "email-verification",
  });
  expect(push).not.toHaveBeenCalled();
  submitCode();
  await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith(next));
  expect(verifyEmail).toHaveBeenCalledExactlyOnceWith({ email, otp: "012345" });
});

it("does not return to the shop after the verification endpoint rejects the code", async () => {
  hosted();
  params.set("next", "/shop?ref=TEST-REF");
  verifyEmail.mockResolvedValueOnce({ data: null, error: { message: "Invalid code" } });
  render(frame);
  submitCode();
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid code");
  expect(push).not.toHaveBeenCalled();
});

it.each([null, "https://outside.invalid", "/chat", "/shopper", "/shop/%2fblocked"])(
  "falls back to the hosted storefront when next is not an allowed shop destination: %s",
  async (next) => {
    hosted();
    if (next !== null) params.set("next", next);
    render(frame);
    submitCode();
    await waitFor(() => expect(push).toHaveBeenCalledExactlyOnceWith("/shop"));
  },
);

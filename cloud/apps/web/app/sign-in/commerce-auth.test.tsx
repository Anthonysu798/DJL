import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const { auth, push } = vi.hoisted(() => ({
  auth: {
    signIn: { email: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    twoFactor: {
      verifyTotp: vi.fn(),
      sendOtp: vi.fn(),
      verifyOtp: vi.fn(),
      verifyBackupCode: vi.fn(),
    },
    signOut: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    emailOtp: { sendVerificationOtp: vi.fn() },
  },
  push: vi.fn(),
}));
let params = new URLSearchParams("next=/shop");
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => params }));
vi.mock("@/lib/auth-client", () => ({ authClient: auth }));
vi.mock("@/lib/config", () => ({ GOOGLE_SIGN_IN_ENABLED: true, APPLE_SIGN_IN_ENABLED: true }));
vi.mock("@/components/AuthFrame", async (original) => ({
  ...(await original<typeof import("@/components/AuthFrame")>()),
  AuthFrame: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <main>
      {children}
      {footer}
    </main>
  ),
}));
import { LocaleProvider } from "@/lib/locale-context";
import SignInPage from "./page";
import SignUpPage from "../sign-up/page";
import ForgotPasswordPage from "../forgot-password/page";
import ResetPasswordPage from "../reset-password/page";

beforeEach(() => {
  for (const method of [
    auth.signIn.email,
    auth.signIn.social,
    auth.signUp.email,
    auth.twoFactor.verifyTotp,
    auth.twoFactor.sendOtp,
    auth.twoFactor.verifyOtp,
    auth.twoFactor.verifyBackupCode,
    auth.signOut,
    auth.requestPasswordReset,
    auth.resetPassword,
    auth.emailOtp.sendVerificationOtp,
  ]) {
    method.mockReset();
    method.mockResolvedValue({ data: {}, error: null });
  }
  auth.signIn.email.mockResolvedValue({ data: signedIn, error: null });
  push.mockReset();
  params = new URLSearchParams("next=/shop");
  Reflect.deleteProperty(window, "djlCommerce");
});
const native = () =>
  Object.defineProperty(window, "djlCommerce", {
    configurable: true,
    value: { kind: "desktop", openCheckout: vi.fn() },
  });
const show = (page: ReactNode) => render(<LocaleProvider locale="zh-Hans">{page}</LocaleProvider>);

it("keeps Google and Apple OAuth available in the ordinary web login and registration pages", async () => {
  const login = show(<SignInPage />);
  fireEvent.click(await screen.findByRole("button", { name: "使用 Google 登录" }));
  await waitFor(() =>
    expect(auth.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: `${window.location.origin}/shop`,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "使用 Apple 登录" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "使用 Apple 登录" }));
  await waitFor(() =>
    expect(auth.signIn.social).toHaveBeenCalledWith({
      provider: "apple",
      callbackURL: `${window.location.origin}/shop`,
    }),
  );
  login.unmount();
  show(<SignUpPage />);
  expect(await screen.findByRole("button", { name: "使用 Google 登录" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "使用 Apple 登录" })).toBeInTheDocument();
});
it("does not start or offer external OAuth inside the native shop, even for an old auto-Google return path", async () => {
  native();
  params = new URLSearchParams({ next: "/authorize?method=google" });
  show(<SignInPage />);
  await screen.findByText(/当前独立商城窗口仅支持邮箱和密码登录/);
  expect(screen.queryByRole("button", { name: /Google|Apple/ })).not.toBeInTheDocument();
  expect(auth.signIn.social).not.toHaveBeenCalled();
});
it("uses the original email/password sign-in and return route in the native commerce window", async () => {
  native();
  show(<SignInPage />);
  await screen.findByText(/当前独立商城窗口仅支持邮箱和密码登录/);
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "buyer@test.invalid" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Synthetic-password-123!" } });
  fireEvent.submit(screen.getByRole("button", { name: "登录" }).closest("form")!);
  await waitFor(() =>
    expect(auth.signIn.email).toHaveBeenCalledWith({
      email: "buyer@test.invalid",
      password: "Synthetic-password-123!",
      rememberMe: true,
    }),
  );
  expect(push).toHaveBeenCalledWith("/shop");
  expect(auth.signIn.social).not.toHaveBeenCalled();
});
it("keeps registration email-based in the native shop instead of exposing another OAuth dead end", async () => {
  native();
  show(<SignUpPage />);
  await screen.findByText(/当前独立商城窗口仅支持邮箱和密码注册/);
  expect(screen.queryByRole("button", { name: /Google|Apple/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Test Buyer" } });
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "buyer@test.invalid" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Synthetic-password-123!" } });
  fireEvent.submit(screen.getByRole("button", { name: "创建账户" }).closest("form")!);
  await waitFor(() =>
    expect(auth.signUp.email).toHaveBeenCalledWith({
      name: "Test Buyer",
      email: "buyer@test.invalid",
      password: "Synthetic-password-123!",
    }),
  );
  expect(push).toHaveBeenCalledWith("/verify?email=buyer%40test.invalid&next=%2Fshop");
  expect(auth.signIn.social).not.toHaveBeenCalled();
});

const recoveryNext = "/shop?ref=TEST-REF&category=Home+Office#favorites";
const recoveryQuery = new URLSearchParams({ next: recoveryNext }).toString();

it("links the native commerce sign-in to recovery with the original shop destination", async () => {
  native();
  params = new URLSearchParams({ next: recoveryNext });
  show(<SignInPage />);
  expect(await screen.findByRole("link", { name: "忘记密码" })).toHaveAttribute(
    "href",
    `/forgot-password?${recoveryQuery}`,
  );
});

it("preserves the shop destination in the same-origin reset callback and back-to-login link", async () => {
  params = new URLSearchParams({ next: recoveryNext });
  show(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "buyer@test.invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "发送重置链接" }));
  await waitFor(() =>
    expect(auth.requestPasswordReset).toHaveBeenCalledWith({
      email: "buyer@test.invalid",
      redirectTo: `${window.location.origin}/reset-password?${recoveryQuery}`,
    }),
  );
  expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute(
    "href",
    `/sign-in?${recoveryQuery}`,
  );
});

it.each([
  { invalid: false, link: "登录", path: "/sign-in" },
  { invalid: true, link: "忘记密码", path: "/forgot-password" },
])(
  "preserves shop return context without forwarding the reset token (invalid=$invalid)",
  async ({ invalid, link, path }) => {
    params = new URLSearchParams({ next: recoveryNext, token: "synthetic-reset-token" });
    if (invalid) params.set("error", "INVALID_TOKEN");
    show(<ResetPasswordPage />);
    if (!invalid) {
      fireEvent.change(screen.getByLabelText("密码"), {
        target: { value: "Synthetic-password-123!" },
      });
      fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
      await waitFor(() =>
        expect(auth.resetPassword).toHaveBeenCalledWith({
          token: "synthetic-reset-token",
          newPassword: "Synthetic-password-123!",
        }),
      );
    } else {
      expect(auth.resetPassword).not.toHaveBeenCalled();
    }
    expect(await screen.findByRole("link", { name: link })).toHaveAttribute(
      "href",
      `${path}?${recoveryQuery}`,
    );
  },
);

it.each([null, "https://outside.invalid", "//outside.invalid", "/%2e%2e//outside.invalid"])(
  "keeps ordinary recovery links bare when next is absent or unsafe (%s)",
  async (next) => {
    params = next ? new URLSearchParams({ next }) : new URLSearchParams();
    const login = show(<SignInPage />);
    expect(await screen.findByRole("link", { name: "忘记密码" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    login.unmount();

    const forgot = show(<ForgotPasswordPage />);
    expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute("href", "/sign-in");
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "buyer@test.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "发送重置链接" }));
    await waitFor(() =>
      expect(auth.requestPasswordReset).toHaveBeenCalledWith({
        email: "buyer@test.invalid",
        redirectTo: `${window.location.origin}/reset-password`,
      }),
    );
    forgot.unmount();

    params.set("token", "synthetic-reset-token");
    const reset = show(<ResetPasswordPage />);
    expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute("href", "/sign-in");
    reset.unmount();

    params.set("error", "INVALID_TOKEN");
    show(<ResetPasswordPage />);
    expect(screen.getByRole("link", { name: "忘记密码" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  },
);

const signedIn = { token: "synthetic-token", user: { email: "buyer@test.invalid" } };
const signIn = () => {
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "buyer@test.invalid" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Synthetic-password-123!" } });
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
};
const challenge = (twoFactorMethods?: string[]) => {
  auth.signIn.email.mockResolvedValueOnce({
    data: { twoFactorRedirect: true, twoFactorMethods },
    error: null,
  });
  const view = show(<SignInPage />);
  signIn();
  return view;
};
const fillFactor = (value: string, label = "六位验证码") =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const verify = () => screen.getByRole("button", { name: "验证并登录" });

it("does not navigate on the password 2FA challenge and confirms TOTP before returning to the shop", async () => {
  native();
  params = new URLSearchParams({ next: recoveryNext });
  challenge(["totp"]);
  const heading = await screen.findByRole("heading", { name: "两步验证" });
  expect(heading).toHaveFocus();
  expect(push).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "邮箱验证码" })).not.toBeInTheDocument();
  expect(auth.twoFactor.sendOtp).not.toHaveBeenCalled();
  fillFactor("123");
  fireEvent.click(verify());
  expect(auth.twoFactor.verifyTotp).not.toHaveBeenCalled();

  auth.twoFactor.verifyTotp.mockResolvedValueOnce({ data: signedIn, error: null });
  fillFactor("012345");
  fireEvent.click(verify());
  await waitFor(() => expect(push).toHaveBeenCalledWith(recoveryNext));
  expect(auth.twoFactor.verifyTotp).toHaveBeenCalledExactlyOnceWith({ code: "012345" });
});

it("waits for an explicit email code request and verifies the email factor only after requesting it", async () => {
  challenge(["otp"]);
  await screen.findByRole("heading", { name: "两步验证" });
  expect(auth.twoFactor.sendOtp).not.toHaveBeenCalled();
  expect(screen.queryByRole("radio", { name: "验证器应用" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "备用恢复码" })).not.toBeInTheDocument();
  expect(verify()).toBeDisabled();
  auth.twoFactor.sendOtp.mockResolvedValueOnce({ data: { status: true }, error: null });
  fireEvent.click(screen.getByRole("button", { name: "发送邮箱验证码" }));
  await screen.findByRole("status");
  expect(auth.twoFactor.sendOtp).toHaveBeenCalledExactlyOnceWith({});
  expect(push).not.toHaveBeenCalled();

  auth.twoFactor.verifyOtp.mockResolvedValueOnce({ data: signedIn, error: null });
  fillFactor("654321");
  fireEvent.click(verify());
  await waitFor(() => expect(push).toHaveBeenCalledWith("/shop"));
  expect(auth.twoFactor.verifyOtp).toHaveBeenCalledExactlyOnceWith({ code: "654321" });
  expect(auth.twoFactor.verifyTotp).not.toHaveBeenCalled();
});

it("accepts a backup code without enabling trusted-device login", async () => {
  challenge(["totp", "otp"]);
  fireEvent.click(await screen.findByRole("radio", { name: "备用恢复码" }));
  auth.twoFactor.verifyBackupCode.mockResolvedValueOnce({ data: signedIn, error: null });
  fillFactor("AbC12-xYz34", "恢复码");
  fireEvent.click(verify());
  await waitFor(() => expect(push).toHaveBeenCalledWith("/shop"));
  expect(auth.twoFactor.verifyBackupCode).toHaveBeenCalledExactlyOnceWith({ code: "AbC12-xYz34" });
  expect(auth.twoFactor.sendOtp).not.toHaveBeenCalled();
});

it.each([undefined, ["unknown"]])(
  "fails closed without advertised supported factors (%s)",
  async (methods) => {
    challenge(methods);
    await screen.findByRole("heading", { name: "两步验证" });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(auth.twoFactor.sendOtp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回登录" }));
    expect(screen.getByLabelText("密码")).toHaveValue("");
    expect(auth.signOut).not.toHaveBeenCalled();
  },
);

it.each([null, { token: "synthetic-token", user: { email: "other@test.invalid" } }])(
  "does not navigate without confirmation for the account that entered the password (%s)",
  async (data) => {
    challenge(["totp"]);
    await screen.findByRole("heading", { name: "两步验证" });
    auth.twoFactor.verifyTotp.mockResolvedValueOnce({ data, error: null });
    fillFactor("012345");
    fireEvent.click(verify());
    await screen.findByRole("alert");
    expect(push).not.toHaveBeenCalled();
    expect(verify()).toBeEnabled();
  },
);

it("cannot restart during verification or submit twice, and ignores a late result after unmount", async () => {
  const view = challenge(["totp"]);
  await screen.findByRole("heading", { name: "两步验证" });
  let finish!: (result: { data: typeof signedIn; error: null }) => void;
  auth.twoFactor.verifyTotp.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fillFactor("012345");
  const form = verify().closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(auth.twoFactor.verifyTotp).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "返回登录" })).toBeDisabled();
  view.unmount();
  await act(async () => finish({ data: signedIn, error: null }));
  expect(push).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it("handles a failed password request without navigating or retaining an in-flight UI", async () => {
  auth.signIn.email.mockRejectedValueOnce(new TypeError("Offline"));
  show(<SignInPage />);
  signIn();
  await screen.findByRole("alert");
  expect(push).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/LocaleProvider";
import LoginPage from "./page";
import { AuthenticatorSetup } from "./AuthenticatorSetup";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@gsap/react", () => ({ useGSAP: () => undefined }));
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("localized public administrator authentication", () => {
  it("shows translated sign-in and password controls without changing entered values", async () => {
    localStorage.setItem("djl_admin_locale", "zh-Hans");
    render(
      <LocaleProvider>
        <LoginPage />
      </LocaleProvider>,
    );
    await screen.findByRole("heading", { name: "欢迎回来。" });
    const password = screen.getByLabelText("密码") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "Unsubmitted private fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password.type).toBe("text");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fr" } });
    await screen.findByRole("heading", { name: "Bon retour." });
    expect(screen.getByLabelText("Mot de passe")).toBe(password);
    expect(password.value).toBe("Unsubmitted private fixture");
  });

  it("localizes QR setup instructions without translating the secret or URI", async () => {
    localStorage.setItem("djl_admin_locale", "zh-Hans");
    render(
      <LocaleProvider>
        <AuthenticatorSetup
          secret="FIXTURESETUPKEY"
          uri="otpauth://totp/DJL%20Admin:fixture?secret=JBSWY3DPEHPK3PXP"
        />
      </LocaleProvider>,
    );
    await screen.findByText("使用验证器扫码");
    expect(screen.getByRole("img", { name: "DJL Admin验证器二维码" })).toBeTruthy();
    expect(screen.getByText("FIXT URES ETUP KEY")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "otpauth://totp/DJL%20Admin:fixture?secret=JBSWY3DPEHPK3PXP",
    );
  });
});

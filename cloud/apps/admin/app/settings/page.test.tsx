import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider, useI18n } from "@/components/LocaleProvider";
import SettingsPage from "./page";
vi.mock("@/components/Shell", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/api", () => ({ admin: vi.fn(async () => []) }));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("preserves a setting draft when the locale changes through another tab", async () => {
  let switchLocale!: () => void;
  function Control() {
    const { setLocale } = useI18n();
    switchLocale = () => setLocale("fr");
    return null;
  }
  render(
    <LocaleProvider>
      <Control />
      <SettingsPage />
    </LocaleProvider>,
  );
  fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]!);
  const field = await screen.findByLabelText("Credits", { exact: true });
  fireEvent.change(field, { target: { value: "321" } });
  await act(async () => switchLocale());
  expect((screen.getByLabelText("Crédits", { exact: true }) as HTMLInputElement).value).toBe("321");
  expect(screen.getByRole("dialog")).toBeTruthy();
});

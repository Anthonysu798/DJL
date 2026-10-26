import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageSelector } from "./LanguageSelector";
import { LocaleProvider, useI18n } from "./LocaleProvider";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n/locale";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.lang = "en";
  vi.restoreAllMocks();
});

function Form() {
  const { t } = useI18n();
  return (
    <>
      <LanguageSelector />
      <input aria-label="Fixture input" defaultValue="Keep this text" />
      <p>{t("nav.models")}</p>
    </>
  );
}

describe("admin language selection", () => {
  it("changes copy and document language while preserving the input node and value", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    render(
      <LocaleProvider>
        <Form />
      </LocaleProvider>,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Unsubmitted reason" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zh-Hans" } });
    await screen.findByText("模型");
    expect(document.documentElement.lang).toBe("zh-Hans");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-Hans");
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input.value).toBe("Unsubmitted reason");
  });

  it("restores a saved preference without crashing when storage becomes unavailable", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    render(
      <LocaleProvider>
        <Form />
      </LocaleProvider>,
    );
    await screen.findByText("Modèles");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ja" } });
    await waitFor(() => expect(document.documentElement.lang).toBe("ja"));
    expect(screen.getByText("モデル")).toBeTruthy();
  });
});

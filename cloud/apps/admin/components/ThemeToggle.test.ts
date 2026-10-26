import { afterEach, describe, expect, it } from "vitest";

import { THEME_BOOT_SCRIPT } from "./ThemeToggle";

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

describe("theme before first paint", () => {
  it("defaults to dark", () => {
    window.eval(THEME_BOOT_SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
  it("preserves an explicit light preference", () => {
    document.documentElement.classList.add("dark");
    localStorage.setItem("djl-admin-theme", "light");
    window.eval(THEME_BOOT_SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
  it("uses dark for an invalid saved value", () => {
    localStorage.setItem("djl-admin-theme", "invalid");
    window.eval(THEME_BOOT_SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

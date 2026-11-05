import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/lib/locale-context";
import { AuthFrame } from "./AuthFrame";

vi.mock("@gsap/react", () => ({ useGSAP: vi.fn() }));

const frame = (
  <LocaleProvider locale="en">
    <AuthFrame footer={<button type="button">Return to sign-in</button>}>
      <h1>Sign in</h1>
    </AuthFrame>
  </LocaleProvider>
);

afterEach(() => {
  Reflect.deleteProperty(window, "djlCommerce");
});

it("does not expose blocked AI links before or after hydration in the hosted shop", async () => {
  Object.defineProperty(window, "djlCommerce", {
    configurable: true,
    value: { kind: "desktop", openCheckout: vi.fn() },
  });
  const initial = renderToString(frame);
  expect(initial).not.toContain('href="/chat"');
  expect(initial).not.toContain('href="/about-ai"');

  render(frame);
  expect(await screen.findByRole("link", { name: "DJL Cloud" })).toHaveAttribute("href", "/shop");
  expect(screen.queryByRole("link", { name: "Learn more" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Privacy Policy" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Return to sign-in" })).toBeInTheDocument();
});

it("keeps the original chat brand and AI notice on ordinary web auth", async () => {
  render(frame);
  expect(await screen.findByRole("link", { name: "DJL Cloud" })).toHaveAttribute("href", "/chat");
  expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "/about-ai");
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeInTheDocument();
});

// FILE: glass.browser.tsx
// Purpose: Locks down the liquid-glass surfaces: blur only under data-glass="blur",
//          no filter anywhere under "tint", never a filter on buttons or the scrim.
// Layer: Web UI browser tests
// Set VITE_GLASS_SCREENSHOT_DIR to an absolute directory to also save one PNG per
// scene for a visual pass (never commit them).

import "../../index.css";

import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { buildThemeCssVariables, DEFAULT_THEME_STATE, resolveThemePack } from "~/theme/theme.logic";

import { Button } from "./button";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "./command";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./dialog";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "./menu";
import {
  COMPACT_NOTIFICATION_SURFACE_CLASS_NAME,
  EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME,
} from "./notificationSurface";
import { Popover, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger } from "./popover";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./tooltip";

type GlassMode = "blur" | "tint";
type Variant = "light" | "dark";

const SCREENSHOT_DIR: string | undefined = import.meta.env.VITE_GLASS_SCREENSHOT_DIR;

const CASES: Array<{ mode: GlassMode; variant: Variant }> = [
  { mode: "blur", variant: "light" },
  { mode: "blur", variant: "dark" },
  { mode: "tint", variant: "light" },
  { mode: "tint", variant: "dark" },
];

const BUTTON_VARIANTS = [
  "default",
  "destructive",
  "outline",
  "secondary",
  "subtle",
  "primary-outline",
  "secondary-outline",
  "destructive-outline",
  "chrome-outline",
  "ghost",
  "chrome",
  "link",
] as const;

function applyAppearance(variant: Variant, mode: GlassMode) {
  const html = document.documentElement;
  html.classList.toggle("dark", variant === "dark");
  const theme = buildThemeCssVariables(resolveThemePack(DEFAULT_THEME_STATE, variant), variant);
  for (const [key, value] of Object.entries(theme.variables)) html.style.setProperty(key, value);
  html.setAttribute("data-glass", mode);
}

function slot(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (!element) throw new Error(`Missing [data-slot="${name}"]`);
  return element;
}

function testId(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Missing [data-testid="${id}"]`);
  return element;
}

/** The filtered layer of a glass surface is its ::before, never the element holding the text. */
function expectGlassSurface(element: HTMLElement, mode: GlassMode) {
  expect(getComputedStyle(element).backdropFilter).toBe("none");
  const layerFilter = getComputedStyle(element, "::before").backdropFilter;
  if (mode === "blur") {
    expect(layerFilter).toContain("blur(");
  } else {
    expect(layerFilter).toBe("none");
  }
}

function expectNoFilter(element: HTMLElement) {
  expect(getComputedStyle(element).backdropFilter).toBe("none");
  expect(getComputedStyle(element, "::before").backdropFilter).toBe("none");
}

function alphaOf(color: string): number {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data[3]! / 255;
}

async function saveScreenshot(name: string) {
  if (!SCREENSHOT_DIR) return;
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

/** Loud stripes and dense text, so a missing blur or a weak fill is obvious. */
function BusyBackground() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 overflow-hidden"
      style={{
        background:
          "repeating-linear-gradient(115deg, #2563eb 0 34px, #f59e0b 34px 68px, #10b981 68px 102px, #ef4444 102px 136px, #f8fafc 136px 170px, #0f172a 170px 204px)",
      }}
    >
      <p className="p-4 font-mono text-sm leading-5 text-white mix-blend-difference">
        {"The quick brown fox jumps over the lazy dog. 0123456789 ".repeat(120)}
      </p>
    </div>
  );
}

function FloatingScene() {
  return (
    <TooltipProvider>
      <BusyBackground />
      <div className="fixed left-6 top-6">
        <Menu open>
          <MenuTrigger render={<Button variant="outline" />}>Menu</MenuTrigger>
          <MenuPopup align="start" className="min-w-52">
            <MenuGroup>
              <MenuGroupLabel>Workspace</MenuGroupLabel>
              <MenuItem>New thread</MenuItem>
              <MenuItem>Rename project</MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem>Delete project</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="fixed left-80 top-6">
        <Popover open>
          <PopoverTrigger render={<Button variant="secondary" />}>Popover</PopoverTrigger>
          <PopoverPopup align="start" className="w-64">
            <PopoverTitle className="text-sm">Usage this week</PopoverTitle>
            <PopoverDescription className="mt-1 text-xs">
              62% of the weekly limit is left. Resets on Monday at 9:00.
            </PopoverDescription>
          </PopoverPopup>
        </Popover>
      </div>
      <div className="fixed left-[42rem] top-24">
        <Tooltip open>
          <TooltipTrigger render={<Button variant="subtle" />}>Tooltip</TooltipTrigger>
          <TooltipPopup side="bottom">Open the usage details</TooltipPopup>
        </Tooltip>
      </div>
      <div className="fixed bottom-40 left-6 flex w-80 flex-col gap-3">
        <div
          className={cn(COMPACT_NOTIFICATION_SURFACE_CLASS_NAME, "px-3 py-2 text-xs")}
          data-testid="toast-compact"
        >
          Thread archived
        </div>
        <div
          className={cn(EXPANDED_NOTIFICATION_SURFACE_CLASS_NAME, "px-3 py-2.5")}
          data-testid="toast-expanded"
        >
          <div className="text-sm font-medium">Update ready</div>
          <div className="text-xs text-[var(--notification-fg)]/72">
            Restart DJL to finish installing version 0.6.0.
          </div>
        </div>
      </div>
      <div
        className="fixed inset-x-6 bottom-6 flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--color-background-surface)] p-4"
        data-testid="buttons"
      >
        {BUTTON_VARIANTS.map((variant) => (
          <Button key={variant} variant={variant} data-variant={variant}>
            {variant}
          </Button>
        ))}
        <Button variant="outline" size="icon" aria-label="Icon button">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="8" r="4" />
          </svg>
        </Button>
        <Button variant="outline" disabled>
          disabled
        </Button>
      </div>
    </TooltipProvider>
  );
}

function DialogScene({ surface }: { surface: "composer" | "solid" }) {
  return (
    <>
      <BusyBackground />
      <Dialog open>
        <DialogPopup surface={surface}>
          <DialogHeader>
            <DialogTitle>Archive this project?</DialogTitle>
            <DialogDescription>
              Its threads move to the archive. You can restore them later from Settings.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <p className="text-sm">12 threads and 3 terminals will be archived.</p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline">Cancel</Button>
            <Button variant="destructive-outline">Delete instead</Button>
            <Button>Archive</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function CommandScene() {
  return (
    <>
      <BusyBackground />
      <CommandDialog open>
        <CommandDialogPopup>
          <Command items={["New thread", "Open settings", "Switch project"]}>
            <CommandPanel>
              <CommandInput placeholder="Search threads and commands" />
              <CommandList>
                {(item: string) => (
                  <CommandItem key={item} value={item}>
                    {item}
                  </CommandItem>
                )}
              </CommandList>
            </CommandPanel>
            <CommandFooter>
              <span>Type to search</span>
              <span>Enter to open</span>
            </CommandFooter>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </>
  );
}

function GlassModeProbe() {
  const { setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("dark")}>
      Apply theme
    </button>
  );
}

describe("liquid glass surfaces", () => {
  afterEach(async () => {
    await cleanup();
    document.documentElement.removeAttribute("data-glass");
    localStorage.removeItem("djl.debug.glass");
  });

  it.each(CASES)(
    "renders menus, popovers, tooltips and toasts as $mode glass in $variant",
    async ({ mode, variant }) => {
      await page.viewport(1100, 720);
      applyAppearance(variant, mode);
      await render(<FloatingScene />);
      await expect.element(page.getByRole("menuitem", { name: "New thread" })).toBeVisible();
      await expect.element(page.getByText("Open the usage details")).toBeVisible();

      expectGlassSurface(slot("menu-popup"), mode);
      expectGlassSurface(slot("popover-popup"), mode);
      expectGlassSurface(slot("tooltip-popup"), mode);
      expectGlassSurface(testId("toast-compact"), mode);
      expectGlassSurface(testId("toast-expanded"), mode);

      // Tint is the solid fallback: content behind a panel must not show through.
      const menuAlpha = alphaOf(getComputedStyle(slot("menu-popup")).backgroundColor);
      if (mode === "tint") {
        expect(menuAlpha).toBe(1);
      } else {
        expect(menuAlpha).toBeLessThan(0.9);
      }

      // Buttons are tinted controls, never filtered layers.
      for (const button of testId("buttons").querySelectorAll<HTMLElement>("[data-slot=button]")) {
        expectNoFilter(button);
      }
      await saveScreenshot(`floating-${variant}-${mode}`);
    },
  );

  it.each(CASES)(
    "renders dialogs as strong $mode glass over a dim-only scrim in $variant",
    async ({ mode, variant }) => {
      await page.viewport(1100, 720);
      applyAppearance(variant, mode);
      await render(<DialogScene surface="composer" />);
      await expect.element(page.getByRole("dialog")).toBeVisible();

      expectGlassSurface(slot("dialog-popup"), mode);
      // The scrim only dims: a full-window backdrop-filter escapes the macOS window corners.
      const scrim = getComputedStyle(slot("dialog-backdrop"));
      expect(scrim.backdropFilter).toBe("none");
      expect(alphaOf(scrim.backgroundColor)).toBeGreaterThan(0.2);
      await saveScreenshot(`dialog-${variant}-${mode}`);
    },
  );

  it.each(CASES)(
    "keeps solid form dialogs opaque and unfiltered in $variant $mode",
    async ({ mode, variant }) => {
      await page.viewport(1100, 720);
      applyAppearance(variant, mode);
      await render(<DialogScene surface="solid" />);
      await expect.element(page.getByRole("dialog")).toBeVisible();

      const popup = slot("dialog-popup");
      expectNoFilter(popup);
      expect(alphaOf(getComputedStyle(popup).backgroundColor)).toBe(1);
      await saveScreenshot(`dialog-solid-${variant}-${mode}`);
    },
  );

  it.each(CASES)(
    "renders the command palette as strong $mode glass in $variant",
    async ({ mode, variant }) => {
      await page.viewport(1100, 720);
      applyAppearance(variant, mode);
      await render(<CommandScene />);
      await expect.element(page.getByText("Open settings")).toBeVisible();

      expectGlassSurface(slot("command-dialog-popup"), mode);
      expect(getComputedStyle(slot("command-dialog-backdrop")).backdropFilter).toBe("none");
      await saveScreenshot(`command-${variant}-${mode}`);
    },
  );

  it("applies the glass mode to the document and honors the debug override", async () => {
    const storedTheme = localStorage.getItem("djl:theme");
    document.documentElement.removeAttribute("data-glass");
    const screen = await render(<GlassModeProbe />);
    const apply = screen.getByRole("button", { name: "Apply theme" });

    await apply.click();
    expect(["blur", "tint"]).toContain(document.documentElement.getAttribute("data-glass"));

    localStorage.setItem("djl.debug.glass", "tint");
    await apply.click();
    expect(document.documentElement.getAttribute("data-glass")).toBe("tint");

    localStorage.setItem("djl.debug.glass", "blur");
    await apply.click();
    expect(document.documentElement.getAttribute("data-glass")).toBe("blur");

    if (storedTheme === null) localStorage.removeItem("djl:theme");
    else localStorage.setItem("djl:theme", storedTheme);
  });
});

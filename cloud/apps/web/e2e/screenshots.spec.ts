/**
 * Captures the main screens in light and dark for visual review.
 * Runs only when SCREENSHOT_DIR is set: `SCREENSHOT_DIR=/tmp/shots bun run test:e2e screenshots`.
 */
import { expect, test, type Page } from "@playwright/test";

const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, "SCREENSHOT_DIR not set");

async function fresh(page: Page, theme: "light" | "dark", scenario = "default") {
  await page.addInitScript(
    ([t, s]) => {
      if (!sessionStorage.getItem("djl.e2e.init")) {
        localStorage.clear();
        localStorage.setItem("djl-web-theme", t!);
        localStorage.setItem("djl.mock.scenario", s!);
        localStorage.setItem("djl.mock.tickMs", "5");
        sessionStorage.setItem("djl.e2e.init", "1");
      }
    },
    [theme, scenario],
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`screens (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 860 });
    await fresh(page, theme);
    await page.goto("/chat");
    await expect(page.getByRole("heading", { name: "What can I help with?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Trip plan" })).toBeVisible();
    await page.screenshot({ path: `${dir}/${theme}-new-chat.png` });

    await page.goto("/chat/conv_1");
    await expect(page.getByText("Here is a plan.")).toBeVisible();
    await page.getByRole("button", { name: "Used 1 tool" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${theme}-conversation.png` });

    await page.getByRole("button", { name: /^Model:/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${theme}-model-picker.png` });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Open image full screen" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${theme}-image-viewer.png` });
    await page.keyboard.press("Escape");

    await page.goto("/chat");
    await page.getByRole("button", { name: "Task" }).click();
    await page.getByLabel(/Describe a task/).fill("Research the history of tide tables");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Task complete")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Task complete/ }).click();
    await page.screenshot({ path: `${dir}/${theme}-task.png` });

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${theme}-account-menu.png` });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Share" }).click();
    await page.getByRole("button", { name: "Create link" }).click();
    await expect(page.getByLabel("Share link")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${theme}-share.png` });
    const url = await page.getByLabel("Share link").inputValue();
    await page.goto(new URL(url).pathname);
    await expect(page.getByText("Read-only", { exact: false })).toBeVisible();
    await page.screenshot({ path: `${dir}/${theme}-public-share.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chat/conv_1");
    await expect(page.getByText("Here is a plan.")).toBeVisible();
    await page.screenshot({ path: `${dir}/${theme}-phone-conversation.png` });
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${theme}-phone-sidebar.png` });
  });

  test(`usage exhausted (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 860 });
    await fresh(page, theme, "exhausted");
    await page.goto("/chat/conv_seed_2");
    await expect(page.getByText("You've reached your 5-hour limit")).toBeVisible();
    await page.screenshot({ path: `${dir}/${theme}-usage-exhausted.png` });
    await page.getByRole("button", { name: "Use a banked reset" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${theme}-usage-confirm.png` });
  });
}

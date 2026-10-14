import { expect, test, type Page } from "@playwright/test";

const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const email = "account-qa@example.invalid";

async function boot(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/v1/auth/get-session*", (route) =>
    route.fulfill({
      json: {
        user: { id: userId, email, emailVerified: true },
        session: { id: sessionId, userId, expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    }),
  );
  await page.route("**/v1/me", (route) =>
    route.fulfill({
      json: {
        user: { id: userId, email, emailVerified: true },
        activeOrgId: userId,
        role: "owner",
        organizations: [],
      },
    }),
  );
  await page.route("**/v1/credits", (route) =>
    route.fulfill({
      json: {
        balances: { free: "20000000" },
        display: { total: "520.00", trial: "0.00", plan: "0.00", topup: "500.00" },
      },
    }),
  );
  await page.route("**/v1/csrf", (route) => route.fulfill({ json: { token: "account-qa-csrf" } }));
  await page.route("**/v1/devices", (route) =>
    route.fulfill({
      status: 201,
      json: { device: { id: deviceId, kind: "web", syncEnabled: false } },
    }),
  );
  await page.route("**/v1/devices/sessions", (route) =>
    route.fulfill({
      json: {
        sessions: [
          {
            id: sessionId,
            deviceId,
            kind: "web",
            name: null,
            platform: null,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/141.0",
            ipAddress: "198.51.100.24",
            createdAt: "2030-10-13T12:00:00.000Z",
            lastSeenAt: "2030-10-13T13:00:00.000Z",
            expiresAt: "2030-11-13T12:00:00.000Z",
            current: true,
          },
        ],
      },
    }),
  );
}

test("account details, balances, typed deletion confirmation and cancel", async ({ page }) => {
  await boot(page);
  await page.goto("/account");
  await expect(page).toHaveURL(/settings\?tab=account/);
  await expect(page.getByRole("heading", { name: "Account details" })).toBeVisible();
  await expect(page.getByText(email, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("30 days");
  await expect(dialog).toContainText("does not cancel subscriptions");
  await expect(dialog.getByRole("button", { name: "Delete account", exact: true })).toBeDisabled();
  await dialog.getByLabel("Confirm your email").fill("someone-else@example.invalid");
  await expect(dialog.getByText("The email address does not match your account.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete account", exact: true })).toBeDisabled();
  await dialog.getByLabel("Confirm your email").fill(email);
  await expect(dialog.getByRole("button", { name: "Delete account", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("deletion sends the authenticated DELETE and returns to sign-in", async ({ page }) => {
  await boot(page);
  let removed = false;
  await page.route("**/v1/me", async (route) => {
    if (route.request().method() === "DELETE") {
      removed = true;
      expect(route.request().headers()["x-csrf-token"]).toBe("account-qa-csrf");
      await route.fulfill({ json: { deleted: true } });
    } else await route.fulfill({ json: { user: { id: userId, email, emailVerified: true } } });
  });
  await page.route("**/v1/auth/sign-out", (route) => route.fulfill({ json: { success: true } }));
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Confirm your email").fill(email);
  await dialog.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  expect(removed).toBe(true);
});

test("failed deletion stays in the confirmation dialog and can be retried", async ({ page }) => {
  await boot(page);
  await page.route("**/v1/me", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 500,
          json: { error: { code: "delete_failed", message: "Could not delete the account." } },
        })
      : route.fulfill({ json: { user: { id: userId, email, emailVerified: true } } }),
  );
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Confirm your email").fill(email);
  await dialog.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not delete the account.");
  await expect(dialog.getByRole("button", { name: "Delete account", exact: true })).toBeEnabled();
});

test("Devices has a separate navigation target and displays real session fields", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/chat/settings");
  await page
    .getByRole("navigation", { name: "Settings", exact: true })
    .getByRole("link", { name: "Devices", exact: true })
    .click();
  await expect(page).toHaveURL(/tab=devices/);
  await expect(page.getByText("198.51.100.24", { exact: true })).toBeVisible();
  await expect(page.getByText(deviceId, { exact: true })).toBeVisible();
  await expect(page.getByText(sessionId, { exact: true })).toBeVisible();
  await expect(page.getByText("This session", { exact: true })).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy device ID" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(deviceId);
});

test("shadcn theme picker supports keyboard selection and mobile account layout fits", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/chat/settings?tab=appearance");
  await page.getByRole("combobox", { name: "Theme" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("combobox", { name: "Theme" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByRole("option", { name: "Dark", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Danger zone" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

import { expect, test } from "@playwright/test";

test("work mode, settings, theme persistence, and language switch", async ({ page }) => {
  await page.goto("/chat");
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await expect(page.getByLabel(/Describe a task/)).toBeVisible();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByLabel("Message DJL", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue("light");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Dark mode" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "General", exact: true }).click();
  await page.getByLabel("Language", { exact: true }).selectOption("zh-Hans");
  await expect(page.getByRole("heading", { name: "通用", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
});

test("mobile settings drawer closes after navigating and has no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chat/settings");
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByLabel("Theme", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("sign-in validation, password visibility, auth error, and safe return path", async ({
  page,
}) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/v1/auth/sign-in/email", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      }),
    });
  });
  await page.goto("/sign-in?next=%2Fchat%2Fsettings");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect(requestBody).toBeUndefined();
  await expect(page.getByText("Enter your email address.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Email", { exact: true })).toHaveCSS(
    "border-color",
    "rgb(220, 38, 38)",
  );
  await page.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("TestPassword123");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password" })).toHaveText(
    "Invalid email or password",
  );
  expect(requestBody).toMatchObject({ email: "qa@example.invalid", password: "TestPassword123" });
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/sign-up\?next=%2Fchat%2Fsettings/);
});

test("sign-up submits to auth and reaches email verification", async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/v1/auth/sign-up/email", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "qa", name: "QA", email: "qa@example.invalid" },
        token: null,
      }),
    });
  });
  await page.goto("/sign-up?next=%2Fchat");
  await page.getByLabel("Name", { exact: true }).fill("QA");
  await page.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("TestPassword123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/verify\?email=qa%40example.invalid&next=%2Fchat/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(requestBody).toMatchObject({
    name: "QA",
    email: "qa@example.invalid",
    password: "TestPassword123",
  });
});

test("provider sign-in preserves the callback destination", async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/v1/auth/sign-in/social", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ redirect: false, url: null }),
    });
  });
  await page.goto("/sign-in?next=%2Fchat%2Fsettings");
  await page.getByRole("button", { name: "Google", exact: true }).click();
  await expect
    .poll(() => requestBody)
    .toMatchObject({ provider: "google", callbackURL: new URL("/chat/settings", page.url()).href });
});

test("authentication screens fit desktop and mobile and respect reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/sign-in", "/sign-up"]) {
      await page.goto(route);
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: route === "/sign-in" ? "Sign in" : "Create account",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  }
});

test("sign-up custom validation rejects missing fields, malformed email, and short passwords", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/v1/auth/sign-up/email", async (route) => {
    requests++;
    await route.abort();
  });
  await page.goto("/sign-up");
  await expect(page.locator("header img")).toHaveAttribute("src", /djl-logo/);
  expect(
    await page.locator("header img").evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(page.getByText("Enter your name.", { exact: true })).toBeVisible();
  await expect(page.getByText("Enter your email address.", { exact: true })).toBeVisible();
  await expect(page.getByText("Enter your password.", { exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("QA");
  await expect(page.getByText("Enter your name.", { exact: true })).toBeHidden();
  await expect(page.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "false");
  await page.getByLabel("Email", { exact: true }).fill("invalid-email");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Enter a valid email address.", { exact: true })).toBeVisible();
  await expect(page.locator("#password-error")).toHaveText("Use at least 10 characters.");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "aria-describedby",
    "password-error",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveCSS(
    "border-color",
    "rgb(220, 38, 38)",
  );
  expect(requests).toBe(0);
});

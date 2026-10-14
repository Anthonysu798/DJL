import { expect, test, type Page } from "@playwright/test";

async function signedOut(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/v1/auth/get-session*", (route) => route.fulfill({ json: null }));
}

test("sign-in red validation, focus, password visibility and retry", async ({ page }) => {
  await signedOut(page);
  let requests = 0;
  await page.route("**/v1/auth/sign-in/email", (route) => {
    requests++;
    return route.fulfill({
      status: 401,
      json: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
  expect(requests).toBe(0);
  await page.getByLabel("Email", { exact: true }).fill("wrong-email");
  await page.getByLabel("Password", { exact: true }).fill("invalid-test-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Invalid email or password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  expect(requests).toBe(1);
});

test("remember preference and safe return path reach email sign-in", async ({ page }) => {
  await signedOut(page);
  let sent: Record<string, unknown> | undefined;
  await page.route("**/v1/auth/sign-in/email", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      json: { user: { id: "qa", email: "qa@example.invalid" }, token: "qa-only" },
    });
  });
  await page.goto("/sign-in?email=qa%40example.invalid&next=%2Fabout-ai");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("qa@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("local-test-password");
  await page.getByLabel("Remember for 30 days").uncheck();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/about-ai$/);
  expect(sent?.rememberMe).toBe(false);
});

test("sign-up validates name and password before sending a request", async ({ page }) => {
  await signedOut(page);
  await page.goto("/sign-up");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Auth QA");
  await page.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Use at least 10 characters." }),
  ).toBeVisible();
});

test("unverified email preserves verification and return paths", async ({ page }) => {
  await signedOut(page);
  await page.route("**/v1/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 403,
      json: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
    }),
  );
  await page.route("**/v1/auth/email-otp/send-verification-otp", (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.goto("/sign-in?next=%2Fbilling");
  await page.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/verify\?email=qa%40example.invalid&next=%2Fbilling/);
});

test("desktop Google handoff starts once and surfaces failure", async ({ page }) => {
  await signedOut(page);
  let calls = 0;
  await page.route("**/v1/auth/sign-in/social", (route) => {
    calls++;
    return route.fulfill({
      status: 400,
      json: { code: "PROVIDER_ERROR", message: "Provider temporarily unavailable" },
    });
  });
  await page.goto("/sign-in?next=%2Fauthorize%3Fmethod%3Dgoogle");
  await expect(page.getByText("Provider temporarily unavailable")).toBeVisible();
  expect(calls).toBe(1);
  await expect(page.getByRole("button", { name: "Log in with Google" })).toBeEnabled();
});

test("forgot password sends the configured reset callback", async ({ page }) => {
  await signedOut(page);
  let sent: Record<string, unknown> | undefined;
  await page.route("**/v1/auth/request-password-reset", (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { status: true } });
  });
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password" }).click();
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
  expect(sent?.redirectTo).toBe(`${new URL(page.url()).origin}/reset-password`);
});

test("expired reset link has a recovery route", async ({ page }) => {
  await signedOut(page);
  await page.goto("/reset-password?error=INVALID_TOKEN");
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  await expect(page.getByRole("link", { name: "Forgot password" })).toHaveAttribute(
    "href",
    "/forgot-password",
  );
});

test("auth pages remain usable on mobile", async ({ page }) => {
  await signedOut(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/sign-in", "/sign-up"]) {
    await page.goto(path);
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByRole("link", { name: "Learn more" })).toBeVisible();
  }
});

// Guest paths are tested against a server with NEXT_PUBLIC_DJL_MOCK_API=false.
test("guest welcome dialog, email validation and stay logged out", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_DJL_MOCK_API !== "false",
    "Requires the session-enabled server",
  );
  await signedOut(page);
  await page.goto("/chat");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByText("Enter your email address.")).toBeVisible();
  await dialog.getByRole("button", { name: "Stay logged out" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByRole("button", { name: "Message DJL" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email", { exact: true }).fill("qa@example.invalid");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in\?email=qa%40example.invalid/);
});

test("private chat and settings still require sign-in", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_DJL_MOCK_API !== "false",
    "Requires the session-enabled server",
  );
  await signedOut(page);
  for (const path of ["/chat/settings", "/chat/11111111-1111-4111-8111-111111111111"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  }
});

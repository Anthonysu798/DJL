import { expect, test, type Page } from "@playwright/test";

async function boot(page: Page, subscription: unknown = null, invoices: unknown[] = []) {
  await page.route("**/v1/auth/get-session*", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "billing-qa",
          name: "Billing QA",
          email: "qa@example.invalid",
          emailVerified: true,
        },
        session: { id: "session-qa", userId: "billing-qa", expiresAt: "2099-01-01T00:00:00.000Z" },
      },
    }),
  );
  await page.route("**/v1/billing/subscription", (route) =>
    route.fulfill({ json: { subscription, invoices } }),
  );
  await page.route("**/v1/credits", (route) =>
    route.fulfill({ json: { display: { total: "125.50" }, total: "125500000" } }),
  );
  await page.route("**/v1/csrf", (route) => route.fulfill({ json: { token: "billing-qa-csrf" } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
}

test("monthly plan comparison shows real prices, limits, balance, and empty invoices", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "More room for your ideas." })).toBeVisible();
  for (const [plan, price, credits] of [
    ["Starter", "$20", "2,000"],
    ["Business", "$60", "6,500"],
    ["Autopilot", "$180", "21,000"],
  ] as const) {
    const card = page.getByRole("article", { name: plan });
    await expect(card).toContainText(price);
    await expect(card).toContainText(`${credits} credits every month`);
    await expect(card.getByRole("button", { name: `Choose ${plan}` })).toBeEnabled();
  }
  await expect(page.getByRole("region", { name: "Your plan" })).toContainText("125.5");
  await expect(
    page.getByText("Your invoices will appear here after your first payment."),
  ).toBeVisible();
  await expect(page.getByText("Monthly plans · billed in USD")).toBeVisible();
  await expect(page.getByRole("button", { name: /yearly|annual/i })).toHaveCount(0);
});

for (const plan of ["starter", "business", "autopilot"]) {
  test(`choosing ${plan} starts monthly checkout and redirects`, async ({ page }) => {
    await boot(page);
    let body: unknown;
    await page.route("**/v1/billing/checkout", async (route) => {
      body = route.request().postDataJSON();
      expect(route.request().headers()["x-csrf-token"]).toBe("billing-qa-csrf");
      await route.fulfill({ json: { url: new URL("/checkout-preview", page.url()).href } });
    });
    await page.route("**/checkout-preview", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Checkout preview</h1>" }),
    );
    await page.goto("/billing");
    await page
      .getByRole("button", { name: `Choose ${plan[0]!.toUpperCase() + plan.slice(1)}` })
      .click();
    await expect(page.getByRole("heading", { name: "Checkout preview" })).toBeVisible();
    expect(body).toEqual({ kind: "subscription", planId: plan, interval: "month" });
  });
}

test("top-up presets, live credit preview, red validation, and checkout amount", async ({
  page,
}) => {
  await boot(page);
  let body: unknown;
  await page.route("**/v1/billing/checkout", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { url: new URL("/checkout-preview", page.url()).href } });
  });
  await page.route("**/checkout-preview", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Checkout preview</h1>" }),
  );
  await page.goto("/billing");
  await page.getByRole("button", { name: "$50", exact: true }).click();
  await expect(page.getByLabel("Top-up amount (USD)")).toHaveValue("50");
  await expect(page.getByText("You’ll receive 5,000 credits.")).toBeVisible();
  for (const amount of ["", "2", "10.5", "10001"]) {
    await page.getByLabel("Top-up amount (USD)").fill(amount);
    await page.getByRole("button", { name: "Buy credits", exact: true }).click();
    await expect(page.locator("#topup-error")).toHaveText(
      "Enter a whole-dollar amount from $5 to $10,000.",
    );
    await expect(page.getByLabel("Top-up amount (USD)")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Top-up amount (USD)")).toBeFocused();
    expect(body).toBeUndefined();
  }
  await page.getByRole("button", { name: "$20", exact: true }).click();
  await expect(page.locator("#topup-error")).toBeHidden();
  await page.getByRole("button", { name: "Buy credits", exact: true }).click();
  await expect(page).toHaveURL(/checkout-preview/);
  expect(body).toEqual({ kind: "topup", usd: 20 });
});

test("active plan changes go through portal, shows cancellation date and invoices", async ({
  page,
}) => {
  await boot(
    page,
    {
      planId: "business",
      status: "active",
      interval: "month",
      currentPeriodEnd: "2030-10-20T00:00:00.000Z",
      cancelAtPeriodEnd: true,
    },
    [
      {
        id: "invoice-qa",
        status: "paid",
        amountPaidUsdCents: 6000,
        currency: "usd",
        hostedInvoiceUrl: "https://invoice.stripe.com/qa",
        createdAt: "2030-09-20T12:00:00.000Z",
      },
    ],
  );
  let portal = 0;
  let checkouts = 0;
  await page.route("**/v1/billing/checkout", (route) => {
    checkouts++;
    return route.abort();
  });
  await page.route("**/v1/billing/portal", (route) => {
    portal++;
    return route.fulfill({ json: { url: new URL("/portal-preview", page.url()).href } });
  });
  await page.route("**/portal-preview", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Portal preview</h1>" }),
  );
  await page.goto("/billing");
  await expect(page.getByRole("article", { name: "Business" })).toContainText("Current plan");
  await expect(page.getByText(/Ends on/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View invoice" })).toHaveAttribute(
    "href",
    "https://invoice.stripe.com/qa",
  );
  await page
    .getByRole("article", { name: "Starter" })
    .getByRole("button", { name: "Change plan" })
    .click();
  await expect(page.getByRole("heading", { name: "Portal preview" })).toBeVisible();
  expect(portal).toBe(1);
  expect(checkouts).toBe(0);
});

test("failed checkout restores controls and displays the API error", async ({ page }) => {
  await boot(page);
  await page.route("**/v1/billing/checkout", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "billing_paused", message: "Billing is temporarily paused." } },
    }),
  );
  await page.goto("/billing");
  await page.getByRole("button", { name: "Choose Starter" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Billing is temporarily paused." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose Starter" })).toBeEnabled();
});

test("billing fits desktop and mobile in both themes", async ({ page }) => {
  await boot(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/billing");
    await expect(page.getByRole("button", { name: "Choose Business" })).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("switch", { name: "Dark mode" }).click();
    await expect(page.getByRole("button", { name: "Choose Business" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("load failure disables purchase controls until retry succeeds", async ({ page }) => {
  await boot(page);
  let fail = true;
  await page.route("**/v1/billing/subscription", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Billing is unavailable." } },
        })
      : route.fulfill({ json: { subscription: null, invoices: [] } }),
  );
  await page.goto("/billing");
  await expect(page.getByText("Billing is unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose Business" })).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Choose Business" })).toBeEnabled();
});

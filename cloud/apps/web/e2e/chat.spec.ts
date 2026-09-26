/**
 * Chat flows against the in-browser mock API. Every test gets a fresh browser
 * context, so the mock database starts from the contract fixtures each time.
 */
import { expect, test, type Page } from "@playwright/test";

async function boot(page: Page, { scenario = "default", tickMs = 5 } = {}) {
  await page.addInitScript(
    ([s, t]) => {
      if (localStorage.getItem("djl.mock.scenario") === null) {
        localStorage.setItem("djl.mock.scenario", s!);
        localStorage.setItem("djl.mock.tickMs", t!);
      }
    },
    [scenario, String(tickMs)],
  );
}

const composer = (page: Page) => page.getByLabel("Message DJL");
const assistant = (page: Page) => page.locator('article[data-role="assistant"]');
const user = (page: Page) => page.locator('article[data-role="user"]');

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

async function waitForReply(page: Page) {
  await expect(page.getByRole("button", { name: "Regenerate" }).last()).toBeVisible({
    timeout: 20_000,
  });
}

test("new chat streams, then edit, regenerate, and branch switching", async ({ page }) => {
  await boot(page);
  await page.goto("/chat");
  await send(page, "How do tides work?");
  await expect(page).toHaveURL(/\/chat\/conv_/);
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await waitForReply(page);
  await expect(assistant(page)).toContainText("Here's a quick take on How do tides work?");
  await expect(page.getByRole("link", { name: "How do tides work?" })).toBeVisible(); // sidebar title

  // Edit the question: a new branch.
  await user(page).hover();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Edit message").fill("How do ocean tides work?");
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await expect(user(page)).toContainText("How do ocean tides work?");
  await waitForReply(page);
  await expect(user(page).getByText("2 / 2")).toBeVisible();

  // Regenerate the reply: a new sibling answer.
  await page.getByRole("button", { name: "Regenerate" }).click();
  await waitForReply(page);
  await expect(assistant(page).getByText("2 / 2")).toBeVisible();
  await expect(assistant(page)).toContainText("Another way to look at");

  // Switch back to the first answer, then to the first question.
  await assistant(page).getByRole("button", { name: "Previous version" }).click();
  await expect(assistant(page).getByText("1 / 2")).toBeVisible();
  await expect(assistant(page)).toContainText("Here's a quick take");
  await user(page).hover();
  await user(page).getByRole("button", { name: "Previous version" }).click();
  await expect(user(page)).toContainText("How do tides work?");
  await expect(user(page).getByText("1 / 2")).toBeVisible();
});

test("stop cancels a streaming reply, and a reload resumes an unfinished one", async ({ page }) => {
  await boot(page, { tickMs: 120 });
  await page.goto("/chat");
  await send(page, "Tell me a long story");
  await expect(assistant(page)).toContainText("Here's", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(assistant(page)).toContainText("Want me to go deeper", { timeout: 30_000 });
  // Resumed without replaying text that was already on screen.
  await expect(assistant(page).getByText("Here's a quick take", { exact: false })).toHaveCount(1);

  await send(page, "Another one");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Stopped")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("uploads an image and rejects an unsupported file inline", async ({ page }) => {
  await boot(page);
  await page.goto("/chat");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles([
    { name: "photo.png", mimeType: "image/png", buffer: png },
    { name: "tool.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") },
  ]);
  await expect(
    page.getByRole("alert").filter({ hasText: "tool.exe isn't supported" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove photo.png" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Uploading" })).toHaveCount(0);
  await send(page, "What's in this photo?");
  await expect(user(page).getByRole("button", { name: "Open image full screen" })).toBeVisible();
  await waitForReply(page);
});

test("generates an image, opens it full screen, zooms, and starts an edit", async ({ page }) => {
  await boot(page);
  await page.goto("/chat");
  await send(page, "Draw a lighthouse at dusk");
  await waitForReply(page);
  await assistant(page).getByRole("button", { name: "Open image full screen" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByRole("button", { name: "Download" })).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.getByRole("button", { name: "Reset zoom" })).toHaveText("150%");
  await viewer.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied. It expires in 5 minutes.")).toBeVisible();
  await viewer.getByRole("button", { name: "Edit image" }).click();
  await expect(viewer).toBeHidden();
  await expect(composer(page)).toHaveValue("Edit this image: ");
  await expect(page.getByRole("button", { name: "Remove Image" })).toBeVisible();
});

test("renames, pins, archives, restores, deletes, and searches chats", async ({ page }) => {
  await boot(page);
  await page.goto("/chat");
  const sidebar = page.getByRole("navigation", { name: "Chat history" });
  await expect(sidebar.getByRole("link", { name: "Weekend hiking checklist" })).toBeVisible();

  await sidebar.getByRole("button", { name: "Options for Weekend hiking checklist" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Chat name").fill("   ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a name.");
  await page.getByLabel("Chat name").fill("Alps hiking checklist");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(sidebar.getByRole("link", { name: "Alps hiking checklist" })).toBeVisible();

  await sidebar.getByRole("button", { name: "Options for Alps hiking checklist" }).click();
  await page.getByRole("menuitem", { name: "Pin" }).click();
  await expect(
    sidebar
      .getByRole("region", { name: "Pinned" })
      .getByRole("link", { name: "Alps hiking checklist" }),
  ).toBeVisible();

  await sidebar.getByRole("button", { name: "Options for Alps hiking checklist" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(sidebar.getByRole("link", { name: "Alps hiking checklist" })).toBeHidden();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Archived chats" }).click();
  const archived = page.getByRole("dialog", { name: "Archived chats" });
  await expect(archived.getByRole("link", { name: "Alps hiking checklist" })).toBeVisible();
  await archived
    .getByRole("listitem")
    .filter({ hasText: "Alps hiking checklist" })
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(archived.getByRole("link", { name: "Alps hiking checklist" })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(sidebar.getByRole("link", { name: "Alps hiking checklist" })).toBeVisible();

  await sidebar.getByRole("button", { name: "Options for Regex for email validation" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Regex for email validation");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(sidebar.getByRole("link", { name: "Regex for email validation" })).toBeHidden();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search chats…").fill("vector");
  await page.getByRole("option", { name: /Explain vector databases/ }).click();
  await expect(page).toHaveURL(/\/chat\/conv_seed_5$/);
  await expect(user(page)).toContainText("Explain vector databases");
});

test("creates, opens, and revokes a share link", async ({ page }) => {
  await boot(page);
  await page.goto("/chat/conv_seed_3");
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Share link").inputValue();
  expect(url).toMatch(/\/share\/tok_/);
  await page.getByRole("dialog").getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Copied" })).toBeVisible();

  await page.goto(new URL(url).pathname);
  await expect(page.getByRole("heading", { name: "Regex for email validation" })).toBeVisible();
  await expect(page.getByText("Read-only", { exact: false })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.goto("/chat/conv_seed_3");
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("No active links for this chat.")).toBeVisible();
  await page.goto(new URL(url).pathname);
  await expect(page.getByText("This link was removed or never existed.")).toBeVisible();
});

test("redeems a banked reset when the 5-hour window is exhausted", async ({ page }) => {
  await boot(page, { scenario: "exhausted" });
  await page.goto("/chat");
  const panel = page.getByRole("region", { name: "You've reached your 5-hour limit" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await panel.getByRole("button", { name: "Use a banked reset" }).click();
  const confirm = page.getByRole("dialog", { name: "Use a banked reset?" });
  await expect(confirm).toContainText("You'll have 1 left.");
  await confirm.getByRole("button", { name: "Use reset" }).click();
  await expect(page.getByText("Reset applied. You're good to go.")).toBeVisible();
  await expect(panel).toBeHidden();
  await send(page, "Back in business");
  await waitForReply(page);
});

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type {
  CommerceAdminWithdrawal,
  CommerceConfirmWithdrawalPaymentInput,
  CommerceLedgerEntry,
  CommerceWallet,
} from "@synara/contracts/cloud";

const ADMIN = "http://localhost:48731";
const API = "http://localhost:48787";
const BUYER = "http://localhost:48789";
const START = "登记开始人工测试付款";
const UNKNOWN = "标记测试付款结果未知";
const CONFIRM = "登记已核验的 TEST 付款成功结果";
const LEGACY = "记录已核实测试付款";
const reason = "Synthetic TEST fixture; no bank transfer";

type Login = { email: string; password: string };
type FinanceLogin = Login & { totpSecret: string };
type Ready = {
  apiOrigin: string;
  adminOrigin: string;
  pid: number;
  withdrawalId: string;
  orderId: string;
  orderItemId: string;
  financeA: FinanceLogin;
  financeB: FinanceLogin;
  referrer: Login;
  withdrawalAmountCents: number;
  refundAmountCents: number;
  initialWallet: CommerceWallet;
  finalWallet: CommerceWallet;
};
type Actor = { page: Page; token: string; id: string };
type WithdrawalReply = { withdrawal: CommerceAdminWithdrawal };
const button = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name, exact: true });

function ready(dir: string): Ready {
  let input: Ready;
  try {
    input = JSON.parse(readFileSync(join(dir, "ready.json"), "utf8")) as Ready;
  } catch {
    throw new Error("The private TEST finance fixture is unreadable.");
  }
  const expectedPid = process.env.DJL_FINANCE_E2E_FIXTURE_PID;
  const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
  if (
    input.apiOrigin !== API ||
    input.adminOrigin !== ADMIN ||
    !Number.isSafeInteger(input.pid) ||
    input.pid <= 0 ||
    (expectedPid !== undefined && Number(expectedPid) !== input.pid) ||
    ![input.withdrawalId, input.orderId, input.orderItemId].every((id) => uuid.test(id)) ||
    ![input.financeA, input.financeB, input.referrer].every(
      (account) => account?.email?.endsWith(".invalid") && account.password,
    ) ||
    input.withdrawalAmountCents !== 5_000 ||
    input.refundAmountCents !== 10_000 ||
    input.initialWallet.frozenCents !== 5_000 ||
    input.finalWallet.recoveryCents !== 1_000
  )
    throw new Error("Not the expected isolated TEST finance fixture.");
  return input;
}

/** The synthetic, pre-enrolled accounts use six-digit SHA-1 TOTP with a 30-second period. */
async function totp(secret: string) {
  let accumulator = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase().replace(/=+$/, "")) {
    const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    if (value < 0) throw new Error("Invalid TEST TOTP seed.");
    accumulator = (accumulator << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
    }
  }
  const remainder = Date.now() % 30_000;
  if (remainder >= 24_000) await delay(30_100 - remainder);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  return String((digest.readUInt32BE(digest[19]! & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function browserRequest(
  page: Page,
  path: string,
  perform: () => Promise<unknown>,
  status = 200,
  method = "POST",
) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => {
      const url = new URL(r.url());
      return (
        url.origin === API && url.pathname === `/admin/v1${path}` && r.request().method() === method
      );
    }),
    perform(),
  ]);
  expect(response.status(), `${method} ${path}`).toBe(status);
  return response;
}

async function admin<T>(
  page: Page,
  token: string,
  path: string,
  data?: object,
  status = 200,
): Promise<T> {
  const response = await page.context().request.fetch(`${API}/admin/v1${path}`, {
    method: data ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, origin: ADMIN },
    ...(data ? { data } : {}),
    maxRedirects: 0,
  });
  expect(response.status(), path).toBe(status);
  return (await response.json()) as T;
}

async function login(page: Page, account: FinanceLogin): Promise<Actor> {
  // Keep locator fill values and API errors from the credential flow out of console reporters.
  try {
    await page.goto(`${ADMIN}/login`);
    await page.locator("#email").fill(account.email);
    await page.locator("#password").fill(account.password);
    const challenge = await browserRequest(
      page,
      "/auth/login",
      () => button(page, "Sign in").click(),
      401,
    );
    if ((await challenge.json()).error?.code !== "totp_required") throw new Error();
    await page.locator("#totp").fill(await totp(account.totpSecret));
    await browserRequest(page, "/auth/login", () => button(page, "Sign in").click());
    await expect(page).toHaveURL(`${ADMIN}/commerce`);
    const token = await page.evaluate(() => sessionStorage.getItem("djl_admin_token"));
    if (!token) throw new Error();
    const { admin: identity } = await admin<{
      admin: { id: string; role: string; commerceRole: string; mfaVerified: boolean };
    }>(page, token, "/me");
    if (
      !identity.id ||
      identity.role !== "commerce" ||
      identity.commerceRole !== "finance" ||
      !identity.mfaVerified
    )
      throw new Error();
    return { page, token, id: identity.id };
  } catch {
    throw new Error("The synthetic finance account could not complete its real MFA sign-in.");
  }
}

test("two finance users preserve an unknown TEST payout and record refund recovery", async ({
  browser,
  playwright,
}) => {
  const dir = process.env.DJL_FINANCE_E2E_DIR;
  if (process.env.DJL_FINANCE_E2E !== "1" || !dir || !isAbsolute(dir))
    throw new Error("Finance fixture not enabled.");
  const stage = (label: string) => writeFileSync(join(dir, "browser-stage"), `${label}\n`);
  stage("fixture-admission");
  const fixture = ready(dir);
  const withdrawalPath = `/commerce/withdrawals/${fixture.withdrawalId}`;
  const contexts: BrowserContext[] = [];
  const referrer = await playwright.request.newContext({
    baseURL: API,
    extraHTTPHeaders: { origin: BUYER },
  });
  let unexpected = 0;
  const pageFor = async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    contexts.push(context);
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === ADMIN ||
        url.origin === API ||
        ["data:", "blob:", "about:"].includes(url.protocol)
      )
        return route.continue();
      unexpected++;
      return route.abort();
    });
    await context.routeWebSocket("**/*", (route) => {
      unexpected++;
      return route.close();
    });
    return context.newPage();
  };
  const wallet = async (expected: CommerceWallet) => {
    const response = await referrer.get("/v1/commerce/wallet", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(expected);
  };
  const withdrawal = async (actor: Actor) =>
    (await admin<WithdrawalReply>(actor.page, actor.token, withdrawalPath)).withdrawal;
  const review = <T>(actor: Actor, action: string, body: object, status = 200) =>
    admin<T>(actor.page, actor.token, `${withdrawalPath}/${action}`, body, status);
  const rowFor = async (page: Page, reload = false) => {
    if (reload)
      await browserRequest(page, "/commerce/withdrawals", () => page.reload(), 200, "GET");
    await expect(button(page, "刷新")).toBeEnabled();
    await button(page, "佣金与提现").click();
    const row = page
      .locator("section")
      .filter({ has: page.getByText(fixture.withdrawalId, { exact: true }) });
    await expect(row).toBeVisible();
    return row;
  };
  const rowStatus = (row: Locator, status: CommerceAdminWithdrawal["status"]) =>
    expect(row.getByText(`CAD 50.00 · ${status}`, { exact: true })).toBeVisible();
  const payout = async (actor: Actor) => {
    const result = await admin<{ entries: CommerceLedgerEntry[]; hasMore: boolean }>(
      actor.page,
      actor.token,
      "/commerce/ledger",
    );
    expect(result.hasMore).toBe(false);
    return result.entries
      .filter((entry) => entry.eventKey === `payout:${fixture.withdrawalId}`)
      .toSorted((a, b) => a.line - b.line);
  };

  try {
    const catalog = await referrer.get("/v1/commerce/catalog", { maxRedirects: 0 });
    expect(catalog.status()).toBe(200);
    expect((await catalog.json()).mode).toBe("test");
    stage("referrer-cookie-login");
    try {
      const response = await referrer.post("/v1/auth/sign-in/email", {
        data: fixture.referrer,
        maxRedirects: 0,
      });
      if (response.status() !== 200) throw new Error();
    } catch {
      throw new Error("The synthetic referrer could not sign in.");
    }
    await wallet(fixture.initialWallet);

    stage("finance-a-mfa-login");
    const a = await login(await pageFor(), fixture.financeA);
    stage("finance-b-mfa-login");
    const b = await login(await pageFor(), fixture.financeB);
    expect(a.id).not.toBe(b.id);

    stage("approval-and-independent-handoff");
    const rowA = await rowFor(a.page);
    await rowStatus(rowA, "requested");
    await browserRequest(a.page, `${withdrawalPath}/approve`, () =>
      button(rowA, "批准测试提现申请").click(),
    );
    await rowStatus(rowA, "approved");
    await expect(rowA.getByText(/本笔由你审批。请交由另一位有财务权限的管理员/)).toBeVisible();
    await expect(button(rowA, START)).toHaveCount(0);
    const denied = await review<{ error: { code: string } }>(
      a,
      "start-payment",
      { operationId: randomUUID(), reason },
      409,
    );
    expect(denied.error.code).toBe("withdrawal_conflict");
    expect(await withdrawal(b)).toMatchObject({
      status: "approved",
      approvedBy: a.id,
      paymentOperationId: null,
    });
    expect(await payout(b)).toEqual([]);

    stage("start-independent-test-operation");
    let rowB = await rowFor(b.page, true);
    await rowStatus(rowB, "approved");
    const note = rowB.getByLabel("人工测试操作原因", { exact: true });
    await note.fill(reason);
    const start = await browserRequest(b.page, `${withdrawalPath}/start-payment`, () =>
      button(rowB, START).click(),
    );
    const operationId = start.request().postDataJSON().operationId as string;
    expect(operationId).toMatch(/^[a-f\d-]{36}$/i);
    expect((await start.json()).withdrawal).toMatchObject({
      status: "payment_pending",
      paymentOperationId: operationId,
      paymentStartedBy: b.id,
    });
    await rowStatus(rowB, "payment_pending");
    stage("record-test-operation-unknown");
    await note.fill(reason);
    await browserRequest(b.page, `${withdrawalPath}/mark-payment-unknown`, () =>
      button(rowB, UNKNOWN).click(),
    );
    await rowStatus(rowB, "payment_unknown");

    stage("reload-and-check-frozen");
    rowB = await rowFor(b.page, true);
    await rowStatus(rowB, "payment_unknown");
    await expect(rowB).toContainText(operationId);
    await expect(rowB.getByText(/结果未确认，需人工核实；金额仍冻结/)).toBeVisible();
    for (const label of [START, LEGACY, "驳回并解冻"])
      await expect(button(rowB, label)).toHaveCount(0);
    await wallet(fixture.initialWallet);
    expect(await payout(b)).toEqual([]);

    stage("confirm-original-test-operation");
    const proof: CommerceConfirmWithdrawalPaymentInput = {
      operationId,
      amountCents: fixture.withdrawalAmountCents,
      currency: "CAD",
      reference: `SYNTHETIC-NO-BANK-${randomUUID()}`,
      evidenceReference: `QA-TEST-${randomUUID()}`,
      reason,
    };
    const form = button(rowB, CONFIRM).locator("xpath=ancestor::form[1]");
    await form.getByLabel("已核验的 TEST 付款流水号", { exact: true }).fill(proof.reference);
    await form
      .getByLabel("TEST 核验依据编号（非截图自动识别）", { exact: true })
      .fill(proof.evidenceReference);
    await form.getByLabel("TEST 成功结果核验原因", { exact: true }).fill(proof.reason);
    await form.getByRole("checkbox").check();
    const confirm = await browserRequest(b.page, `${withdrawalPath}/confirm-payment-success`, () =>
      button(form, CONFIRM).click(),
    );
    expect(confirm.request().postDataJSON()).toEqual(proof);
    const { withdrawal: paid } = (await confirm.json()) as WithdrawalReply;
    expect(paid).toMatchObject({
      status: "paid_test",
      paymentOperationId: operationId,
      paymentConfirmedBy: b.id,
      paymentEvidenceReference: proof.evidenceReference,
    });
    await rowStatus(rowB, "paid_test");
    await expect(rowB).toContainText("不代表真实到账");
    const paidLines = await payout(b);
    expect(paidLines.map(({ account, amountCents }) => [account, amountCents])).toEqual([
      ["frozen", -5_000],
      ["paid", 5_000],
    ]);
    const replay = await review<WithdrawalReply>(b, "confirm-payment-success", proof);
    expect(replay.withdrawal).toEqual(paid);
    expect(await payout(b)).toEqual(paidLines);

    stage("partial-refund-and-visible-recovery");
    await button(b.page, "履约与售后").click();
    const order = b.page.locator("section").filter({
      has: b.page.getByRole("heading", { name: `订单 ${fixture.orderId}`, exact: true }),
    });
    const refund = button(order, "提交测试退款").locator("xpath=ancestor::form[1]");
    await refund.locator('[name="refundTotalCents"]').fill(String(fixture.refundAmountCents));
    await refund.getByLabel("退款原因", { exact: true }).fill(reason);
    const response = await browserRequest(
      b.page,
      `/commerce/items/${fixture.orderItemId}/refund`,
      () => button(refund, "提交测试退款").click(),
    );
    expect((await response.json()).order.refundedCents).toBe(fixture.refundAmountCents);
    await wallet(fixture.finalWallet);
    rowB = await rowFor(b.page, true);
    await rowStatus(rowB, "paid_test");
    await expect(rowB).toContainText(proof.reference);
    const ledger = b.page
      .locator("section")
      .filter({ has: b.page.getByRole("heading", { name: "测试总账追踪", exact: true }) });
    const recovery = ledger
      .getByRole("row")
      .filter({ has: b.page.getByRole("cell", { name: "recovery", exact: true }) });
    await expect(recovery).toContainText(
      `refund:${fixture.orderItemId}:${fixture.refundAmountCents}`,
    );
    await expect(recovery.getByRole("cell", { name: "CAD -10.00", exact: true })).toBeVisible();
    expect(await withdrawal(b)).toEqual(paid);
    expect(await payout(b)).toEqual(paidLines);
    expect(unexpected).toBe(0);
    stage("browser-assertions-complete");
  } finally {
    await Promise.all([...contexts.map((context) => context.close()), referrer.dispose()]);
  }
});

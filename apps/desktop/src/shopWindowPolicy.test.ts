import { describe, expect, it } from "vitest";

import {
  getShopEntryUrl,
  isShopNavigationUrl,
  isShopOpenerUrl,
  isShopResourceUrl,
  selectAiMenuWindow,
  SHOP_WEB_PREFERENCES,
  resolveShopDestination,
  shopSessionPartition,
} from "./shopWindowPolicy";

const production = "synara://app/index.html";
const development = "http://localhost:5173/";
const cloud = resolveShopDestination(
  production,
  {
    DJL_COMMERCE_WEB_URL: "https://shop.test/shop",
    DJL_COMMERCE_API_URL: "https://api.test",
    DJL_COMMERCE_STORAGE_URL: "https://storage.test",
  },
  false,
);
const fileId = "4f623de9-fd7b-40dd-a3bc-7da049bb38a6";
const buyerMfaPaths = [
  "/v1/auth/two-factor/send-otp",
  "/v1/auth/two-factor/verify-otp",
  "/v1/auth/two-factor/verify-totp",
  "/v1/auth/two-factor/verify-backup-code",
];

const scopedWeb = "https://127.0.0.1:48981";
const scopedApi = "https://127.0.0.1:48982";
const scopedEnv = {
  DJL_COMMERCE_SCOPED_TEST: "true",
  DJL_COMMERCE_WEB_URL: `${scopedWeb}/shop`,
  DJL_COMMERCE_API_URL: scopedApi,
};

describe("isolated HTTPS Shop pilot", () => {
  it("requires an explicit development opt-in and canonical same-host TLS origins", () => {
    expect(resolveShopDestination(development, scopedEnv, true)).toMatchObject({
      scopedTest: true,
      apiOrigin: scopedApi,
    });
    expect(() => resolveShopDestination(production, scopedEnv, false)).toThrow();
    for (const invalid of [
      { DJL_COMMERCE_WEB_URL: "" },
      { DJL_COMMERCE_API_URL: scopedApi + "/" },
      { DJL_COMMERCE_WEB_URL: "http://127.0.0.1:48981/shop" },
      { DJL_COMMERCE_WEB_URL: "https://localhost:48981/shop" },
      { DJL_COMMERCE_API_URL: scopedWeb },
      { DJL_COMMERCE_STORAGE_URL: "https://storage.test" },
    ])
      expect(() =>
        resolveShopDestination(development, { ...scopedEnv, ...invalid }, true),
      ).toThrow();
  });

  it("allows only current scoped buyer routes and rejects normal Cloud and local AI surfaces", () => {
    const destination = resolveShopDestination(development, scopedEnv, true);
    expect(shopSessionPartition(destination)).not.toBe(shopSessionPartition(cloud));
    expect(shopSessionPartition(destination)).not.toBe(SHOP_WEB_PREFERENCES.partition);
    expect(
      isShopNavigationUrl(`${scopedWeb}/shop/sign-in?next=%2Fshop`, development, destination),
    ).toBe(true);
    expect(isShopNavigationUrl(`${scopedWeb}/sign-in`, development, destination)).toBe(false);
    const cases = [
      ["GET", "/v1/shop/csrf"],
      ["GET", "/v1/shop/auth/get-session"],
      ["POST", "/v1/shop/auth/sign-in/email"],
      ["POST", "/v1/shop/auth/two-factor/verify-totp"],
      ["GET", "/v1/shop/commerce/catalog"],
      ["GET", "/v1/shop/commerce/orders?page=2"],
      ["POST", "/v1/shop/commerce/orders"],
      ["POST", "/v1/shop/commerce/orders/recover"],
      ["POST", `/v1/shop/commerce/orders/${fileId}/test-pay`],
      ["POST", `/v1/shop/commerce/image-uploads/${fileId}/complete`],
    ];
    for (const [method, path] of cases) {
      expect(isShopResourceUrl(scopedApi + path, development, destination, method)).toBe(true);
      expect(isShopResourceUrl(scopedApi + path, development, destination, "OPTIONS")).toBe(true);
    }
    for (const [method, path] of [
      ["POST", "/v1/auth/sign-in/email"],
      ["GET", "/v1/auth/token"],
      ["GET", "/v1/commerce/orders"],
      ["POST", "/v1/files"],
      ["GET", "/v1/shop/commerce/supplier/orders"],
      ["GET", "/v1/shop/commerce/orders/recover"],
      ["DELETE", "/v1/shop/commerce/orders/recover"],
      ["POST", "/v1/shop/commerce/orders/%72ecover"],
      ["POST", `/v1/shop/commerce/orders/${fileId}/recover`],
      ["POST", `/v1/shop/commerce/orders/${fileId}/checkout`],
      ["POST", "/v1/shop//commerce/orders"],
      ["POST", "/v1/shop/commerce/%6Frders"],
      ["GET", `/v1/shop/commerce/image-uploads/${fileId}/complete`],
    ])
      expect(isShopResourceUrl(scopedApi + path, development, destination, method)).toBe(false);
    expect(isShopResourceUrl(development + "api/work", development, destination, "GET")).toBe(
      false,
    );
  });
});

describe("shop window boundary", () => {
  it("requires explicit hosted Web and API URLs instead of opening the bundled demo", () => {
    const required = { DJL_COMMERCE_REQUIRE_HOSTED: "true" };
    for (const env of [required, { ...required, DJL_COMMERCE_WEB_URL: "   " }]) {
      expect(() => resolveShopDestination(production, env, false)).toThrow(/hosted shop/i);
      expect(() => resolveShopDestination(development, env, true)).toThrow(/hosted shop/i);
    }
    expect(() =>
      resolveShopDestination(
        production,
        { ...required, DJL_COMMERCE_WEB_URL: "https://shop.test/shop" },
        false,
      ),
    ).toThrow(/API origin/i);
    expect(
      resolveShopDestination(
        production,
        {
          ...required,
          DJL_COMMERCE_WEB_URL: "https://shop.test/shop",
          DJL_COMMERCE_API_URL: "https://api.test",
          DJL_COMMERCE_STORAGE_URL: "https://storage.test",
        },
        false,
      ),
    ).toEqual(cloud);
    expect(
      resolveShopDestination(production, { DJL_COMMERCE_REQUIRE_HOSTED: "false" }, false).kind,
    ).toBe("prototype");
  });

  it("does not allow explicit scoped TEST or local hosted destinations in strict mode", () => {
    const required = { DJL_COMMERCE_REQUIRE_HOSTED: "true" };
    expect(() => resolveShopDestination(development, { ...scopedEnv, ...required }, true)).toThrow(
      /scoped TEST/i,
    );
    const valid = {
      ...required,
      DJL_COMMERCE_WEB_URL: "https://shop.test/shop",
      DJL_COMMERCE_API_URL: "https://api.test",
    };
    for (const env of [
      { ...valid, DJL_COMMERCE_WEB_URL: "https://127.0.1.2/shop" },
      { ...valid, DJL_COMMERCE_WEB_URL: "http://localhost:3000/shop" },
      { ...valid, DJL_COMMERCE_API_URL: "https://preview.localhost." },
      { ...valid, DJL_COMMERCE_API_URL: "https://[::1]" },
      { ...valid, DJL_COMMERCE_STORAGE_URL: "https://[::ffff:127.0.0.1]" },
      { ...valid, DJL_COMMERCE_STORAGE_URL: "https://0.0.0.0" },
    ])
      expect(() => resolveShopDestination(development, env, true)).toThrow(/HTTPS|local/i);
  });

  it("admits only the exact Cloud order recovery mutation and its preflight", () => {
    const url = "https://api.test/v1/commerce/orders/recover";
    expect(isShopResourceUrl(url, production, cloud, "POST")).toBe(true);
    expect(isShopResourceUrl(url, production, cloud, "OPTIONS")).toBe(true);
    for (const candidate of [
      url,
      url + "/",
      url.replace("/recover", "/%72ecover"),
      url.replace("/recover", "//recover"),
    ]) {
      expect(isShopResourceUrl(candidate, production, cloud, "GET")).toBe(false);
      if (candidate !== url)
        expect(isShopResourceUrl(candidate, production, cloud, "POST")).toBe(false);
    }
  });

  it("keeps the local prototype default and requires explicit approved cloud origins", () => {
    expect(resolveShopDestination(production, {}, false)).toEqual({
      kind: "prototype",
      entryUrl: "synara://app/shop/index.html",
    });
    expect(() =>
      resolveShopDestination(production, { DJL_COMMERCE_WEB_URL: "https://shop.test/shop" }, false),
    ).toThrow();
    expect(() =>
      resolveShopDestination(
        production,
        {
          DJL_COMMERCE_WEB_URL: "http://localhost:3000/shop",
          DJL_COMMERCE_API_URL: "http://localhost:8787",
        },
        false,
      ),
    ).toThrow();
  });

  it("cloud mode permits only storefront/auth/assets, commerce API and separate storage", () => {
    const destination = cloud;
    expect(getShopEntryUrl(production, destination)).toBe("https://shop.test/shop");
    for (const url of ["https://shop.test/shop/orders", "https://shop.test/sign-in?next=/shop"])
      expect(isShopNavigationUrl(url, production, destination)).toBe(true);
    for (const url of [
      "https://shop.test/_next/static/main.js",
      "https://api.test/v1/commerce/orders",
      "https://api.test/v1/auth/get-session",
      "https://storage.test/org/file",
      "blob:https://shop.test/upload",
    ])
      expect(isShopResourceUrl(url, production, destination, "GET")).toBe(true);
    for (const url of [
      "https://api.test/v1/chat/completions",
      "https://api.test/v1/credits",
      "https://shop.test/chat",
      "https://api.test/v1/commerce/%2e%2e%2fcredits",
      "http://127.0.0.1:3773/api/work",
      "blob:https://elsewhere.test/upload",
    ])
      expect(isShopResourceUrl(url, production, destination)).toBe(false);
    expect(isShopNavigationUrl("https://shop.test/chat", production, destination)).toBe(false);
  });

  it.each([
    ["GET", "/v1/auth/get-session?disableCookieCache=true"],
    ["POST", "/v1/auth/sign-up/email"],
    ["POST", "/v1/auth/sign-in/email"],
    ["POST", "/v1/auth/email-otp/send-verification-otp"],
    ["POST", "/v1/auth/email-otp/verify-email"],
    ["POST", "/v1/auth/sign-out"],
    ["POST", "/v1/auth/request-password-reset"],
    ["POST", "/v1/auth/reset-password"],
    ["GET", "/v1/csrf"],
    ["POST", "/v1/commerce/image-uploads"],
    ["POST", `/v1/commerce/image-uploads/${fileId}/complete`],
  ])("allows the supported %s %s and its CORS preflight", (method, path) => {
    const url = `https://api.test${path}`;
    expect(isShopResourceUrl(url, production, cloud, method)).toBe(true);
    expect(isShopResourceUrl(url, production, cloud, "OPTIONS")).toBe(true);
  });

  it.each([
    ["POST", "/v1/auth/get-session"],
    ["GET", "/v1/auth/sign-out"],
    ["PATCH", "/v1/auth/sign-up/email"],
    ["GET", "/v1/me"],
    ["OPTIONS", "/v1/me"],
    ["DELETE", "/v1/me"],
    ["POST", "/v1/csrf"],
    ["GET", "/v1/files"],
    ["POST", "/v1/files"],
    ["OPTIONS", "/v1/files"],
    ["POST", `/v1/files/${fileId}/complete`],
    ["GET", `/v1/files/${fileId}/complete`],
    ["GET", `/v1/files/${fileId}/url`],
    ["POST", "/v1/files/not-a-uuid/complete"],
    ["POST", `/v1/files/${fileId}/complete/extra`],
    ["GET", "/v1/commerce/image-uploads"],
    ["PATCH", "/v1/commerce/image-uploads"],
    ["GET", `/v1/commerce/image-uploads/${fileId}/complete`],
    ["OPTIONS", "/v1/commerce/image-uploads/not-a-uuid/complete"],
    ["POST", `/v1/commerce/image-uploads/${fileId}/complete/extra`],
    ["POST", "/v1/commerce/image-uploads-extra"],
    ["POST", "/v1/commerce/IMAGE-UPLOADS"],
    ["POST", "/v1/commerce//image-uploads"],
    ["GET", "/v1/commerce/%69mage-uploads"],
    ["POST", "/v1/commerce/%69mage-uploads"],
    ["POST", "/v1/commerce/other/../image-uploads"],
    ["OPTIONS", "/v1/auth/sign-in/email/extra"],
    ["POST", "/v1/auth/sign-in/email/"],
    ["POST", "/v1/auth/sign-in/email-extra"],
    ["POST", "/v1/auth/sign-in/%65mail"],
    ["POST", "/v1/auth/email-otp%2Fverify-email"],
    ["POST", "/v1/auth/sign-in%252Femail"],
    ["POST", "/v1/authentication/sign-in/email"],
    ["GET", "/v1/auth/token"],
    ["GET", "/v1/auth/jwks"],
    ["POST", "/v1/auth/device/token"],
    ["POST", "/v1/auth/sign-in/social"],
    ["POST", "/v1/auth/organization/set-active"],
    ["GET", "/v1/auth/reset-password/SyntheticToken0123456789"],
    ["OPTIONS", "/v1/auth/passkey/generate-authenticate-options"],
  ])("blocks unsupported %s %s", (method, path) => {
    expect(isShopResourceUrl(`https://api.test${path}`, production, cloud, method)).toBe(false);
  });

  it.each(buyerMfaPaths)(
    "permits only POST and OPTIONS for the hosted MFA challenge %s",
    (path) => {
      const url = `https://api.test${path}`;
      for (const method of ["POST", "OPTIONS"])
        expect(isShopResourceUrl(url, production, cloud, method)).toBe(true);
      for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", undefined])
        expect(isShopResourceUrl(url, production, cloud, method)).toBe(false);
      expect(isShopResourceUrl(url, production, undefined, "POST")).toBe(false);
      expect(isShopResourceUrl(`https://shop.test${path}`, production, cloud, "POST")).toBe(false);
      expect(isShopNavigationUrl(url, production, cloud)).toBe(false);
    },
  );

  it.each([
    "enable",
    "disable",
    "get-totp-uri",
    "generate-backup-codes",
    "setup",
    "secret",
    "verify-totp/extra",
    "verify-totp/",
    "verify-totp-extra",
    "%76erify-totp",
    "%2Fverify-totp",
    "verify-totp%5C",
    "./verify-totp",
    "%2e/verify-totp",
    "extra/../verify-totp",
    "extra/%2e%2e/verify-totp",
    "extra\\..\\verify-totp",
  ])("denies management and forged MFA paths even for POST and OPTIONS: %s", (suffix) => {
    for (const method of ["POST", "OPTIONS"])
      expect(
        isShopResourceUrl(
          `https://api.test/v1/auth/two-factor/${suffix}`,
          production,
          cloud,
          method,
        ),
      ).toBe(false);
  });

  it("does not assume a method for a restricted API route", () => {
    expect(isShopResourceUrl("https://api.test/v1/auth/get-session", production, cloud)).toBe(
      false,
    );
  });

  it("keeps checkout, supplier PATCH and storage upload working without API reset navigation", () => {
    for (const [method, url] of [
      ["POST", "https://api.test/v1/commerce/orders/example/checkout"],
      ["GET", "https://api.test/v1/commerce/orders/example/payment"],
      ["POST", "https://api.test/v1/commerce/orders/example/checkout/cancel"],
      ["POST", "https://api.test/v1/commerce/orders/example/test-pay"],
      ["PATCH", "https://api.test/v1/commerce/supplier/products/example/stock"],
      ["PUT", "https://storage.test/org/example?signature=test-only"],
      ["OPTIONS", "https://storage.test/org/example?signature=test-only"],
    ] as const) {
      expect(isShopResourceUrl(url, production, cloud, method)).toBe(true);
    }
    expect(
      isShopNavigationUrl(
        "https://api.test/v1/auth/reset-password/SyntheticToken0123456789?callbackURL=https%3A%2F%2Fshop.test%2Freset-password",
        production,
        cloud,
      ),
    ).toBe(false);
    expect(
      isShopNavigationUrl("https://shop.test/reset-password?token=synthetic", production, cloud),
    ).toBe(true);
  });

  it("rejects credentials, query-bearing configuration and same-origin storage widening", () => {
    const env = {
      DJL_COMMERCE_WEB_URL: "https://shop.test/shop",
      DJL_COMMERCE_API_URL: "https://api.test",
    };
    expect(() =>
      resolveShopDestination(
        production,
        { ...env, DJL_COMMERCE_WEB_URL: "https://user:secret@shop.test/shop" },
        false,
      ),
    ).toThrow();
    expect(() =>
      resolveShopDestination(
        production,
        { ...env, DJL_COMMERCE_API_URL: "https://api.test?token=secret" },
        false,
      ),
    ).toThrow();
    expect(() =>
      resolveShopDestination(
        production,
        { ...env, DJL_COMMERCE_STORAGE_URL: "https://api.test" },
        false,
      ),
    ).toThrow();
  });
  it("routes AI menu commands to the main window when the shop is focused", () => {
    const main = { id: "main" };
    const shop = { id: "shop" };
    expect(selectAiMenuWindow(shop, main, [shop, main], shop)).toBe(main);
  });

  it("leaves no AI menu target when only the shop remains so a main window is created", () => {
    const shop = { id: "shop" };
    expect(selectAiMenuWindow(shop, null, [shop], shop)).toBeNull();
    expect(selectAiMenuWindow(null, null, [shop], shop)).toBeNull();
  });

  it("preserves the existing focused, main, and fallback order for other windows", () => {
    const main = { id: "main" };
    const other = { id: "other" };
    const shop = { id: "shop" };
    expect(selectAiMenuWindow(other, main, [main, other], shop)).toBe(other);
    expect(selectAiMenuWindow(null, main, [other, main], shop)).toBe(main);
    expect(selectAiMenuWindow(shop, null, [shop, other], shop)).toBe(other);
  });

  it("uses a fixed entry independent of the active AI route", () => {
    expect(getShopEntryUrl(production)).toBe("synara://app/shop/index.html");
    expect(getShopEntryUrl(`${development}chat/123?token=secret`)).toBe(
      "http://localhost:5173/shop/index.html",
    );
  });

  it("has a separate session and no Node, webview, or preload privileges", () => {
    expect(SHOP_WEB_PREFERENCES).toMatchObject({
      partition: "persist:djl-shop-prototype",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    });
    expect(SHOP_WEB_PREFERENCES).not.toHaveProperty("preload");
  });

  it("accepts only the AI application as the opener", () => {
    expect(isShopOpenerUrl("synara://app/thread/123", production)).toBe(true);
    expect(isShopOpenerUrl("synara://other/index.html", production)).toBe(false);
    expect(isShopOpenerUrl("synara://app/shop/index.html", production)).toBe(false);
    expect(isShopOpenerUrl("https://example.com/", production)).toBe(false);
    expect(isShopOpenerUrl("http://localhost:9999/", development)).toBe(false);
  });

  it("permits referral and view hashes but not another page or protocol", () => {
    expect(isShopNavigationUrl("synara://app/shop/index.html?ref=demo#cart", production)).toBe(
      true,
    );
    for (const url of [
      "synara://other/shop/index.html",
      "synara://app/index.html",
      "synara://app/shop/../index.html",
      "javascript:alert(1)",
      "https://example.com/shop/index.html",
    ]) {
      expect(isShopNavigationUrl(url, production)).toBe(false);
    }
  });

  it("allows only local shop resources and same-site upload previews", () => {
    expect(isShopResourceUrl("synara://app/shop/app.js", production)).toBe(true);
    expect(isShopResourceUrl("http://localhost:5173/shop/assets/products.png", development)).toBe(
      true,
    );
    expect(isShopResourceUrl("blob:http://localhost:5173/upload", development)).toBe(true);
    for (const url of [
      "http://localhost:5173/v1/orders",
      "http://127.0.0.1:8787/v1/orders",
      "http://localhost:5173/shop/../../index.html",
      "blob:https://example.com/upload",
      "file:///C:/Users/private.txt",
    ]) {
      expect(isShopResourceUrl(url, development)).toBe(false);
    }
  });
});

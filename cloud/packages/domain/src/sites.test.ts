import { describe, expect, it } from "vitest";

import { siteContentHold, siteFilesProblem, siteNameProblem, sitePathProblem } from "./sites.ts";

const TYPES = new Set(["html", "css", "js", "png", "svg", "txt"]);
const LIMITS = { maxFiles: 5, maxBytes: 1000 };

describe("siteNameProblem", () => {
  it("accepts plain names", () => {
    for (const name of ["bakery", "my-shop-2", "abc", "a".repeat(40)])
      expect(siteNameProblem(name)).toBeNull();
  });

  it("rejects badly formed names", () => {
    for (const name of [
      "ab",
      "a".repeat(41),
      "-shop",
      "shop-",
      "my--shop",
      "My-Shop",
      "shop.io",
      "s_p",
    ])
      expect(siteNameProblem(name)).toBe("invalid");
  });

  it("reserves infrastructure, brand and offensive names", () => {
    for (const name of [
      "www",
      "api",
      "admin",
      "djl",
      "slcor-help",
      "paypal-login",
      "mypaypal",
      "apple-id",
      "login",
      "fuck-off",
    ])
      expect(siteNameProblem(name)).toBe("reserved");
  });

  it("does not reserve words that merely contain a short brand", () => {
    expect(siteNameProblem("pineapple-cafe")).toBeNull();
    expect(siteNameProblem("essex-bakery")).toBeNull();
  });
});

describe("sitePathProblem", () => {
  it("accepts normal relative paths", () => {
    expect(sitePathProblem("index.html", TYPES)).toBeNull();
    expect(sitePathProblem("_next/static/chunks/app-1.js", TYPES)).toBeNull();
    expect(sitePathProblem("img/Logo Final.png", TYPES)).toBeNull();
  });

  it("rejects escapes, absolute paths and odd characters", () => {
    for (const path of [
      "../x.html",
      "a/../../x.html",
      "/etc/x.html",
      "a\\b.html",
      "C:/x.html",
      "a//b.html",
      "a/./b.html",
      "x\u0000.html",
      "",
    ])
      expect(sitePathProblem(path, TYPES)).not.toBeNull();
  });

  it("rejects file types that are not allowed", () => {
    expect(sitePathProblem("run.sh", TYPES)).toMatch(/not allowed/);
    expect(sitePathProblem("Makefile", TYPES)).toMatch(/not allowed/);
    expect(sitePathProblem("x.php", TYPES)).toMatch(/not allowed/);
  });

  it("reserves the _djl folder for DJL's own pages", () => {
    expect(sitePathProblem("_djl/report.html", TYPES)).toMatch(/reserved/);
    expect(sitePathProblem("_DJL/report.html", TYPES)).toMatch(/reserved/);
  });

  it("rejects hidden files", () => {
    expect(sitePathProblem(".env", TYPES)).not.toBeNull();
    expect(sitePathProblem("a/.git/config.txt", TYPES)).not.toBeNull();
  });
});

const file = (path: string, size = 10) => ({ path, size });

describe("siteFilesProblem", () => {
  it("needs an index.html at the root", () => {
    expect(siteFilesProblem([file("about.html")], LIMITS)).toMatch(/index\.html/);
    expect(siteFilesProblem([file("index.html"), file("a.css")], LIMITS)).toBeNull();
  });

  it("enforces file count and total size", () => {
    const many = Array.from({ length: 6 }, (_, i) => file(`p${i}.html`));
    expect(siteFilesProblem([file("index.html"), ...many], LIMITS)).toMatch(/files/);
    expect(siteFilesProblem([file("index.html", 999), file("a.css", 2)], LIMITS)).toMatch(
      /MB|bytes/,
    );
  });

  it("rejects duplicate paths, including case-only duplicates", () => {
    expect(siteFilesProblem([file("index.html"), file("Index.html")], LIMITS)).toMatch(/twice/);
  });
});

describe("siteContentHold", () => {
  it("holds pages that ask for passwords", () => {
    expect(siteContentHold('<form><input type="password" name="p"></form>')).toMatch(/password/);
    expect(siteContentHold("<input type=password>")).toMatch(/password/);
  });

  it("holds pages asking for wallet recovery phrases or card details", () => {
    expect(siteContentHold("Enter your 12-word seed phrase to continue")).not.toBeNull();
    expect(siteContentHold("Please confirm your card number and CVV")).not.toBeNull();
    expect(
      siteContentHold("Your account has been suspended. Verify your account now"),
    ).not.toBeNull();
  });

  it("holds forms that post to another site", () => {
    expect(siteContentHold('<form action="https://collect.example.com/x" method="post">')).toMatch(
      /another site/,
    );
  });

  it("lets ordinary pages through", () => {
    expect(
      siteContentHold('<h1>Fresh bread daily</h1><form action="mailto:me@x.com"></form>'),
    ).toBeNull();
    expect(siteContentHold('<a href="https://instagram.com/bakery">Follow us</a>')).toBeNull();
  });
});

// Native node:test entry; kept outside Vitest's *.test.* discovery.
import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createShopPreviewServer } from "./preview-shop.mjs";

test("preview serves only the shop, without exposing the AI app or local files", async (t) => {
  const server = createShopPreviewServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const redirect = await fetch(origin, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/shop/index.html");

  for (const path of [
    "/package.json",
    "/shop/%2e%2e%2f%2e%2e%2fpackage.json",
    "/shop/%5c..%5cpackage.json",
    "/shop/%00.js",
  ]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${origin}/shop/%ZZ`)).status, 400);
  assert.equal((await fetch(`${origin}/shop/index.html`, { method: "POST" })).status, 405);

  const image = await fetch(`${origin}/shop/assets/products.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.match(image.headers.get("content-security-policy"), /connect-src 'none'/);
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  const head = await fetch(`${origin}/shop/assets/products.png`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

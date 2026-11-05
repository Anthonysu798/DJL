import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { previewEnvironment, previewPreflight, rendererReady } from "./desktop-shop-preview.mjs";

test("renderer readiness matches the actual HTML entry and requires a successful response", async (t) => {
  const html = readFileSync(new URL("../apps/web/index.html", import.meta.url), "utf8");
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/error" ? 500 : 200, { "Content-Type": "text/html" });
    response.end(request.url === "/wrong" ? "<html><body>Another application</body></html>" : html);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(
    () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  await t.test("current apps/web/index.html is ready", async () =>
    assert.equal(await rendererReady(base), true),
  );
  await t.test("unrelated200 page is rejected", async () =>
    assert.equal(await rendererReady(`${base}/wrong`), false),
  );
  await t.test("500 with the correct HTML is rejected", async () =>
    assert.equal(await rendererReady(`${base}/error`), false),
  );
});

test("preview isolates every home path and removes inherited cloud/electron mode", () => {
  const profile = join(tmpdir(), "djl-preview-test");
  const base = {
    HOME: "real-home",
    USERPROFILE: "real-profile",
    DJL_HOME: "real-data",
    DJL_DESKTOP_USER_DATA_DIR: "real-electron",
    DJL_COMMERCE_MODE: "test",
    DJL_COMMERCE_WEB_URL: "https://shop.test/shop",
    ELECTRON_RUN_AS_NODE: "1",
    KEEP_ME: "value",
  };
  const env = previewEnvironment(base, profile, "http://127.0.0.1:5733");
  for (const key of [
    "HOME",
    "USERPROFILE",
    "DJL_HOME",
    "SYNARA_HOME",
    "DJL_DESKTOP_USER_DATA_DIR",
    "SYNARA_DESKTOP_USER_DATA_DIR",
  ])
    assert.ok(env[key].startsWith(profile));
  assert.equal(env.DJL_COMMERCE_MODE, undefined);
  assert.equal(env.DJL_COMMERCE_WEB_URL, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.KEEP_ME, "value");
  assert.equal(base.HOME, "real-home");
});

test("preflight reports absent builds without spawning processes", () => {
  const result = previewPreflight(join(tmpdir(), "djl-nonexistent-preview-check"));
  assert.equal(result.vite, undefined);
  assert.equal(result.checks.find((check) => check.name === "AI backend").ok, false);
  assert.equal(result.checks.find((check) => check.name === "Electron runtime").ok, false);
});

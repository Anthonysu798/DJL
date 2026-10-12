import { afterAll, beforeAll, expect, it } from "vitest";
import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { clientConfig, publicPolicyUrl } from "./routes.ts";

let api: ApiRuntime;
beforeAll(async () => {
  api = await startApi({
    env: loadApiEnv({ ...process.env, DJL_ENV: "test" }),
    port: 0,
    host: "127.0.0.1",
  });
});

it("rejects invalid or credential-bearing policy URLs", () => {
  for (const value of ["not a url", "http://example.com", "https://user:secret@example.com"])
    expect(publicPolicyUrl(value)).toBeNull();
  expect(publicPolicyUrl("https://example.com/privacy")).toBe("https://example.com/privacy");
});

it("does not advertise editing for a generation-only model", async () => {
  const config = await clientConfig({
    auth: { google: true, apple: false },
    gateway: {
      listModels: async () => [{ status: "active", capabilities: ["image.generate"] }] as never,
    },
    fileParsing: false,
    pushConfigured: false,
    policyUrls: { terms: null, privacy: null },
  });
  expect(config.tools).toEqual({ imageGeneration: true, imageEditing: false, fileParsing: false });
});
afterAll(async () => {
  await api?.close();
});

it("exposes only configured mobile capabilities without authentication or secrets", async () => {
  const response = await fetch(`http://127.0.0.1:${api.address.port}/v1/client-config`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.auth).toEqual({ google: false, apple: false });
  expect(body.pushConfigured).toBe(false);
  expect(Object.keys(body).sort()).toEqual(["auth", "policyUrls", "pushConfigured", "tools"]);
  expect(body.policyUrls).toEqual({ terms: null, privacy: null });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

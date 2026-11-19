import { expect, it } from "vitest";

import { clientConfig } from "./routes.ts";

it("advertises providers independently while keeping legacy pushConfigured as APNs", async () => {
  const base = {
    auth: { google: false, apple: false },
    gateway: { listModels: async () => [] },
    fileParsing: false,
    policyUrls: { terms: null, privacy: null },
  };
  expect((await clientConfig({ ...base, pushConfigured: false })).pushProviders).toEqual([]);
  const android = await clientConfig({ ...base, pushConfigured: false, fcmConfigured: true });
  expect(android.pushConfigured).toBe(false);
  expect(android.pushProviders).toEqual(["fcm"]);
  expect(
    (await clientConfig({ ...base, pushConfigured: true, fcmConfigured: true })).pushProviders,
  ).toEqual(["apns", "fcm"]);
});

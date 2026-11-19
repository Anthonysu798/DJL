import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { resetSocialAccountCache } from "./accountCache";
it("removes every social/private family without discarding unrelated app data", async () => {
  const client = new QueryClient();
  const keys = [
    "marketing",
    "marketing-chat",
    "social-accounts",
    "social-publishing",
    "social-media-preview",
    "social-metrics",
    "social-review-links",
    "social-reports",
    "social-agent-workflows",
    "social-agent-coach",
    "social-agent-brand",
    "social-agent-library",
  ];
  for (const key of keys) client.setQueryData([key, "same-thread"], { private: "old-account" });
  client.setQueryData(["unrelated-preference"], "keep");
  await resetSocialAccountCache(client);
  for (const key of keys) expect(client.getQueryData([key, "same-thread"])).toBeUndefined();
  expect(client.getQueryData(["unrelated-preference"])).toBe("keep");
  client.clear();
});

import type { QueryClient } from "@tanstack/react-query";

export const SOCIAL_ACCOUNT_CHANGED = "djl:social-account-changed";
const origin = Math.random().toString(36).slice(2);
const families = new Set([
  "marketing",
  "marketing-chat",
  "social-accounts",
  "social-publishing",
  "social-media-preview",
  "social-metrics",
  "social-review-links",
  "social-reports",
  "social-tracking-links",
]);
/** Remove private query data before another signed-in identity can reuse it. */
export async function resetSocialAccountCache(client: QueryClient, notify = true) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SOCIAL_ACCOUNT_CHANGED));
    if (notify && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(SOCIAL_ACCOUNT_CHANGED);
      // BroadcastChannel is already origin-scoped and has no targetOrigin parameter.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      channel.postMessage({ origin });
      channel.close();
    }
  }
  const predicate = (query: { queryKey: readonly unknown[] }) => {
    const family = String(query.queryKey[0] ?? "");
    return families.has(family) || family.startsWith("social-agent-");
  };
  await client.cancelQueries({ predicate });
  client.removeQueries({ predicate, type: "inactive" });
  await client.resetQueries({ predicate, type: "active" });
}
export function subscribeSocialAccountChanges(client: QueryClient) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(SOCIAL_ACCOUNT_CHANGED);
  channel.addEventListener("message", (event: MessageEvent<{ origin?: string }>) => {
    if (event.data?.origin !== origin) void resetSocialAccountCache(client, false);
  });
  return () => channel.close();
}

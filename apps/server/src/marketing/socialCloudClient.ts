import { createCloudClient, type FetchLike } from "../cloud/api";
/** Every social call uses the organization saved alongside the authenticated session. */
export function createSocialCloudClient(
  baseUrl: string,
  orgId: string,
  fetchImpl: FetchLike = fetch,
) {
  return createCloudClient(baseUrl, (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-org-id", orgId);
    return fetchImpl(url, { ...init, headers, redirect: "error", credentials: "omit" });
  });
}

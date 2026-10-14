export type CloudSignInMethod = "email" | "google";

/** Select a browser form without altering the server's PKCE challenge or state. */
export function cloudSignInUrl(authorizeUrl: string, method: CloudSignInMethod): string {
  const url = new URL(authorizeUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Invalid DJL sign-in address.");
  }
  url.searchParams.set("method", method);
  return url.toString();
}

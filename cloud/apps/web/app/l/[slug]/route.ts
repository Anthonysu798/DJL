import { API_URL } from "@/lib/config";
import { validatedTrackingTarget } from "../../../../../packages/domain/src/social/trackingLinks";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = {
  "cache-control": "no-store, private",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
};
async function redirect(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[A-Za-z0-9_-]{22}$/.test(slug))
    return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  const headers = new Headers();
  for (const name of ["purpose", "sec-purpose", "x-purpose", "x-moz"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value.slice(0, 100));
  }
  // No cookies, account credentials, referrer, or destination query overrides reach the API.
  try {
    const response = await fetch(`${API_URL}/v1/social/tracking-links/${slug}/open`, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const location = response.headers.get("location");
    if (response.status === 302 && location && validatedTrackingTarget(location) === location)
      return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, location } });
    return new Response(null, {
      status: response.status === 429 ? 429 : response.status === 404 ? 404 : 503,
      headers: PRIVATE_HEADERS,
    });
  } catch {
    return new Response(null, { status: 503, headers: PRIVATE_HEADERS });
  }
}
export const GET = redirect;
export const HEAD = redirect;

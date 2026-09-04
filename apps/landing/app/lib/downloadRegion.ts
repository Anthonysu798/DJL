// FILE: downloadRegion.ts
// Purpose: Reads the explicit mirror selected by a landing-page download button.
// Layer: Landing download routing

export type RequestedMirror = "cn";

const VISITOR_COUNTRY_HEADER = "x-vercel-ip-country";

export function readRequestedMirror(request: Request): RequestedMirror | null {
  return new URL(request.url).searchParams.get("mirror") === "cn" ? "cn" : null;
}

export function readVisitorCountry(request: Request): string | null {
  const country = request.headers.get(VISITOR_COUNTRY_HEADER)?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

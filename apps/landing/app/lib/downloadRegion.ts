// FILE: downloadRegion.ts
// Purpose: Reads the explicit mirror selected by a landing-page download button.
// Layer: Landing download routing

export type RequestedMirror = "cn";

export function readRequestedMirror(request: Request): RequestedMirror | null {
  return new URL(request.url).searchParams.get("mirror") === "cn" ? "cn" : null;
}

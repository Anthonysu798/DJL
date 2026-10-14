import { safeNext } from "./safeNext";

export function signInMethodFromNext(next: string): "email" | "google" | null {
  const url = new URL(safeNext(next), "https://app.invalid");
  if (url.pathname !== "/authorize" && url.pathname !== "/device") return null;
  const method = url.searchParams.get("method");
  return method === "email" || method === "google" ? method : null;
}

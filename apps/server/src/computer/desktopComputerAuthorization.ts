import { timingSafeEqual } from "node:crypto";
import { isLoopbackAddress } from "@djl/shared/loopback";

/** Physical Escape notices may only come from the local desktop that owns this backend. */
export function authorizeDesktopComputerStop(input: {
  readonly mode: string;
  readonly token: string | undefined;
  readonly authorization: string | undefined;
  readonly remoteAddress: string | undefined;
}): boolean {
  if (input.mode !== "desktop" || !input.token || !isLoopbackAddress(input.remoteAddress))
    return false;
  const actual = Buffer.from(input.authorization ?? "");
  const expected = Buffer.from(`Bearer ${input.token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

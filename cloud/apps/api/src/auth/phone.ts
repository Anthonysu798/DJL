/**
 * The E.164 spelling of a phone number ("+14155550100"): spaces, dashes, dots,
 * and parentheses removed, country code required. Null when the input is not
 * one. Every number has exactly one spelling, so one phone is one identity for
 * sign-in and for the one-trial-per-phone rule.
 */
export function normalizePhoneNumber(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null;
}

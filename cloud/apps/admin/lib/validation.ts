/**
 * Form validation for the admin app. Every form runs these instead of the
 * browser's built-in checks (forms are `noValidate`), so the messages match
 * the design and the API's own rules. A validator returns an error string or
 * null; `validate` runs a map of them and returns the first error per field.
 */
export type Validator = (value: string) => string | null;

export const required =
  (label = "This field"): Validator =>
  (v) =>
    v.trim() ? null : `${label} is required.`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const email: Validator = (v) => {
  const t = v.trim();
  if (!t) return "Email is required.";
  if (t.length > 254 || !EMAIL.test(t)) return "Enter a valid email address.";
  return null;
};

export const length =
  (min: number, max: number, label = "This field"): Validator =>
  (v) => {
    const n = v.trim().length;
    if (n < min)
      return min === 1 ? `${label} is required.` : `${label} needs at least ${min} characters.`;
    if (n > max) return `${label} must be ${max} characters or fewer.`;
    return null;
  };

/** Whole number in [min, max]. Accepts digits only, no separators. */
export const integer =
  (min: number, max: number, label = "Value"): Validator =>
  (v) => {
    const t = v.trim();
    if (!t) return `${label} is required.`;
    if (!/^-?\d+$/.test(t)) return `${label} must be a whole number.`;
    const n = Number(t);
    if (!Number.isSafeInteger(n)) return `${label} is too large.`;
    if (n < min) return `${label} must be at least ${min.toLocaleString()}.`;
    if (n > max) return `${label} must be at most ${max.toLocaleString()}.`;
    return null;
  };

/** Decimal in [min, max] with up to `places` decimal places. */
export const decimal =
  (min: number, max: number, places = 2, label = "Value"): Validator =>
  (v) => {
    const t = v.trim();
    if (!t) return `${label} is required.`;
    if (!new RegExp(`^-?\\d+(\\.\\d{1,${places}})?$`).test(t))
      return `${label} must be a number with up to ${places} decimal places.`;
    const n = Number(t);
    if (n < min) return `${label} must be at least ${min}.`;
    if (n > max) return `${label} must be at most ${max}.`;
    return null;
  };

export const oneOf =
  (options: readonly string[], label = "Value"): Validator =>
  (v) =>
    options.includes(v) ? null : `${label} must be one of ${options.join(", ")}.`;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
export function isIpOrCidr(entry: string): boolean {
  const [addr, bits] = entry.split("/");
  if (!addr) return false;
  const v4 = IPV4.test(addr) && addr.split(".").every((o) => Number(o) <= 255);
  if (bits !== undefined) return v4 && /^\d{1,2}$/.test(bits) && Number(bits) <= 32;
  return v4 || (IPV6.test(addr) && addr.includes(":") && addr.length <= 45);
}
export const ipOrCidr: Validator = (v) =>
  isIpOrCidr(v.trim())
    ? null
    : "Enter an IP address (IPv4 or IPv6) or an IPv4 CIDR like 203.0.113.0/24.";
/** One IP or CIDR per line; blank lines ignored. */
export const ipList: Validator = (v) => {
  const bad = v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .find((l) => !isIpOrCidr(l));
  return bad ? `"${bad}" is not an IP address or IPv4 CIDR.` : null;
};
export const parseIpList = (v: string) =>
  v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** Admin password policy, mirrored from the API so the form can explain before submitting. */
export const password =
  (emailAddress: string): Validator =>
  (v) => {
    if (v.length < 14) return "Use at least 14 characters.";
    if (v.length > 128) return "Use at most 128 characters.";
    const local = emailAddress.split("@")[0]?.toLowerCase() ?? "";
    if (local.length >= 4 && v.toLowerCase().includes(local))
      return "The password must not contain your email address.";
    if (/^(.)\1+$/.test(v)) return "The password cannot be one repeated character.";
    return null;
  };

export const all =
  (...validators: Validator[]): Validator =>
  (v) => {
    for (const validator of validators) {
      const error = validator(v);
      if (error) return error;
    }
    return null;
  };

/** Run a validator map over the values. Returns {} when everything passes. */
export function validate<K extends string>(
  values: Record<K, string>,
  rules: Partial<Record<K, Validator>>,
): Partial<Record<K, string>> {
  const errors: Partial<Record<K, string>> = {};
  for (const key of Object.keys(rules) as K[]) {
    const error = rules[key]?.(values[key] ?? "");
    if (error) errors[key] = error;
  }
  return errors;
}

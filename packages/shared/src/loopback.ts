// Shared loopback checks for features whose data must stay on the user's device.

function normalizeHost(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

export function isLoopbackHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const normalized = normalizeHost(hostname);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  return isLoopbackHostname(normalized);
}

export function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && isLoopbackHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

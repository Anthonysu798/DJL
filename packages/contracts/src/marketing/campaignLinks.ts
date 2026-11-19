export function buildCampaignTrackingLink(input: {
  url: string;
  source: string;
  campaign: string;
  content?: string | undefined;
}) {
  if (
    input.url.length > 4096 ||
    [...input.url].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error("Use a complete website link without control characters.");
  const url = new URL(input.url.trim());
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.includes(":")
  )
    throw new Error("Use a public HTTPS website link without sign-in credentials.");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168) ||
      a! >= 224
    )
      throw new Error("Use a public website link.");
  }
  if (
    [...url.searchParams.keys()].some((key) =>
      /^(access_token|api_key|client_secret|password)$/i.test(key),
    )
  )
    throw new Error("Remove private credentials from the website link.");
  for (const [key, value] of [
    ["utm_source", input.source],
    ["utm_campaign", input.campaign],
    ["utm_content", input.content],
  ] as const) {
    if (key !== "utm_content" && !value?.trim())
      throw new Error("Provide a source and campaign name.");
    // oxlint-disable-next-line no-control-regex -- Tracking labels must reject embedded control characters.
    if (value && (value.length > 120 || /[\u0000-\u001f]/.test(value)))
      throw new Error("Use short, readable tracking values.");
    if (value?.trim()) url.searchParams.set(key, value.trim());
  }
  url.searchParams.set("utm_medium", "social");
  return url.href;
}

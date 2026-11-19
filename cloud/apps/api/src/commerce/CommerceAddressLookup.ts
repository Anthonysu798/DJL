import type {
  CommerceAddressLookupResult,
  CommerceAddressSuggestion,
} from "@synara/contracts/cloud";

import { ApiError } from "../http/errors.ts";

const placesOrigin = "https://places.googleapis.com";
const placeIdPattern = /^[\w-]{1,512}$/;
const sessionPattern = /^[\w-]{1,36}$/;
const maxResponseBytes = 64 * 1024;
const unavailable = () =>
  new ApiError(503, "commerce_address_lookup_unavailable", "Address lookup is unavailable.");
const incomplete = () =>
  new ApiError(
    422,
    "commerce_address_incomplete",
    "Choose a complete Canadian street address or enter it manually.",
  );
const invalidInput = () => new ApiError(400, "bad_request", "Invalid address lookup.");

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value)) return;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

const areaKey = (value: string) =>
  value
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
const canadianAreas = new Map(
  Object.entries({
    AB: ["Alberta"],
    BC: ["British Columbia", "Colombie-Britannique"],
    MB: ["Manitoba"],
    NB: ["New Brunswick", "Nouveau-Brunswick"],
    NL: ["Newfoundland and Labrador", "Terre-Neuve-et-Labrador"],
    NS: ["Nova Scotia", "Nouvelle-Écosse"],
    NT: ["Northwest Territories", "Territoires du Nord-Ouest"],
    NU: ["Nunavut"],
    ON: ["Ontario"],
    PE: ["Prince Edward Island", "Île-du-Prince-Édouard"],
    QC: ["Québec"],
    SK: ["Saskatchewan"],
    YT: ["Yukon", "Yukon Territory"],
  }).flatMap(([code, names]) => [code, ...names].map((name) => [areaKey(name), code] as const)),
);

async function readProviderBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let raw = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxResponseBytes) throw unavailable();
      raw += decoder.decode(chunk.value, { stream: true });
    }
    signal.throwIfAborted();
    return JSON.parse(raw + decoder.decode()) as unknown;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Server-side Google Places (New), limited to Canadian checkout address suggestions. */
export class CommerceAddressLookup {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    url: URL,
    fieldMask: string,
    signal: AbortSignal,
    payload?: Readonly<Record<string, unknown>>,
  ) {
    signal.throwIfAborted();
    if (!/^[\w-]{1,200}$/.test(this.apiKey)) throw unavailable();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    try {
      const response = await this.fetcher(url, {
        method: payload ? "POST" : "GET",
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": fieldMask,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: requestSignal,
      });
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => undefined);
        throw unavailable();
      }
      const data = object(await readProviderBody(response, requestSignal));
      if (!data || Object.hasOwn(data, "error")) throw unavailable();
      return data;
    } catch {
      signal.throwIfAborted();
      throw unavailable();
    }
  }

  async suggest(
    query: string,
    sessionToken: string,
    signal: AbortSignal,
  ): Promise<readonly CommerceAddressSuggestion[]> {
    const input = text(query, 150);
    if (
      !input ||
      input.length < 2 ||
      typeof sessionToken !== "string" ||
      !sessionPattern.test(sessionToken)
    )
      throw invalidInput();
    const data = await this.request(
      new URL("/v1/places:autocomplete", placesOrigin),
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      signal,
      {
        input,
        includedRegionCodes: ["ca"],
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
        sessionToken,
      },
    );
    if (Object.keys(data).length === 0) return [];
    if (!Array.isArray(data.suggestions)) throw unavailable();
    const suggestions: CommerceAddressSuggestion[] = [];
    const seen = new Set<string>();
    for (const item of data.suggestions as unknown[]) {
      const prediction = object(object(item)?.placePrediction);
      const placeId = prediction?.placeId;
      const label = text(object(prediction?.text)?.text, 500);
      if (
        typeof placeId !== "string" ||
        !placeIdPattern.test(placeId) ||
        !label ||
        seen.has(placeId)
      )
        continue;
      seen.add(placeId);
      suggestions.push({ placeId, label });
      if (suggestions.length === 5) break;
    }
    if (data.suggestions.length && !suggestions.length) throw unavailable();
    return suggestions;
  }

  async resolve(
    placeId: string,
    sessionToken: string,
    signal: AbortSignal,
  ): Promise<CommerceAddressLookupResult> {
    if (
      typeof placeId !== "string" ||
      !placeIdPattern.test(placeId) ||
      typeof sessionToken !== "string" ||
      !sessionPattern.test(sessionToken)
    )
      throw invalidInput();
    const url = new URL(`/v1/places/${placeId}`, placesOrigin);
    url.searchParams.set("regionCode", "CA");
    url.searchParams.set("sessionToken", sessionToken);
    const data = await this.request(url, "postalAddress", signal);
    const postal = object(data.postalAddress);
    if (postal?.regionCode !== "CA") throw incomplete();
    const area = text(postal.administrativeArea, 100);
    const province = area && canadianAreas.get(areaKey(area));
    const city = text(postal.locality, 100);
    const postalCode = text(postal.postalCode, 7)?.toUpperCase().replace(" ", "");
    const lines = postal.addressLines;
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 2) throw incomplete();
    const line1 = text(lines[0], 200);
    const line2 = lines.length === 2 ? text(lines[1], 200) : undefined;
    const street = line1?.match(/^\d+\p{L}?(?:[-–]\d+\p{L}?)?,?\s+(.+)$/u)?.[1];
    if (
      !province ||
      !city ||
      !postalCode ||
      !/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(postalCode) ||
      !line1 ||
      !street ||
      !/\p{L}/u.test(street) ||
      (lines.length === 2 && !line2)
    )
      throw incomplete();
    return {
      line1,
      ...(line2 ? { line2 } : {}),
      city,
      province,
      postalCode: `${postalCode.slice(0, 3)} ${postalCode.slice(3)}`,
      country: "CA",
    };
  }
}

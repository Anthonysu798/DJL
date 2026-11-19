import { describe, expect, it, vi } from "vitest";

import { CommerceAddressLookup } from "./CommerceAddressLookup.ts";

const key = "synthetic-places-key-never-sent";
const session = "eae01821-ef08-48d7-8381-cad27b4e2808";
const placeId = "Synthetic_CA_1";
const postalAddress = {
  regionCode: "CA",
  addressLines: ["50, rue Exemple", "Appartement 4"],
  locality: "Montréal",
  administrativeArea: "Québec",
  postalCode: "h2x1y4",
  recipients: ["Synthetic recipient"],
  organization: "Synthetic organization",
};
const expectedAddress = {
  line1: "50, rue Exemple",
  line2: "Appartement 4",
  city: "Montréal",
  province: "QC",
  postalCode: "H2X 1Y4",
  country: "CA",
};
const unavailable = { status: 503, code: "commerce_address_lookup_unavailable" };
const incomplete = { status: 422, code: "commerce_address_incomplete" };
const signal = () => new AbortController().signal;
const json = (body: unknown, status = 200) => Response.json(body, { status });
const prediction = (id: string, label: string) => ({
  placePrediction: { placeId: id, text: { text: label }, extra: "Never returned" },
});
const fetchStub = () =>
  Object.assign(vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(), {
    preconnect: vi.fn<typeof fetch.preconnect>(),
  });

describe("Google Places Canadian checkout address lookup", () => {
  it("sends only Canadian street search data and the same session token using exact field masks", async () => {
    const fetcher = fetchStub()
      .mockResolvedValueOnce(
        json({ suggestions: [prediction(placeId, "50, rue Exemple, Montréal QC")] }),
      )
      .mockResolvedValueOnce(json({ postalAddress, location: { latitude: 1, longitude: 2 } }));
    const lookup = new CommerceAddressLookup(key, fetcher);
    await expect(lookup.suggest("50", session, signal())).resolves.toEqual([
      { placeId, label: "50, rue Exemple, Montréal QC" },
    ]);
    await expect(lookup.resolve(placeId, session, signal())).resolves.toEqual(expectedAddress);

    const [searchUrl, search] = fetcher.mock.calls[0]!;
    expect(String(searchUrl)).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(search).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
    expect(JSON.parse(String(search?.body))).toEqual({
      input: "50",
      includedRegionCodes: ["ca"],
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      sessionToken: session,
    });
    const searchHeaders = new Headers(search?.headers);
    expect(searchHeaders.get("x-goog-api-key")).toBe(key);
    expect(searchHeaders.get("x-goog-fieldmask")).toBe(
      "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    );
    expect(searchHeaders.get("cookie")).toBeNull();
    expect(searchHeaders.get("authorization")).toBeNull();
    const [detailsUrl, details] = fetcher.mock.calls[1]!;
    const detailsPath = new URL(String(detailsUrl));
    expect(detailsPath.origin).toBe("https://places.googleapis.com");
    expect(detailsPath.pathname).toBe(`/v1/places/${placeId}`);
    expect(Object.fromEntries(detailsPath.searchParams)).toEqual({
      regionCode: "CA",
      sessionToken: session,
    });
    expect(String(detailsUrl)).not.toContain(key);
    expect(details).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(details?.body).toBeUndefined();
    expect(new Headers(details?.headers).get("x-goog-fieldmask")).toBe("postalAddress");
  });

  it("deduplicates in provider order, rejects unsafe candidates and returns no more than five", async () => {
    const fetcher = fetchStub()
      .mockResolvedValueOnce(
        json({
          suggestions: [
            prediction("A", "50 Example Rd"),
            prediction("A", "duplicate"),
            prediction("../private", "forged"),
            prediction("B", "50 Example Ave"),
            prediction("C", "50 Example Way"),
            prediction("D", "50 Example Place"),
            prediction("E", "50 Example Street"),
            prediction("F", "not returned"),
          ],
        }),
      )
      .mockResolvedValueOnce(json({}));
    const lookup = new CommerceAddressLookup(key, fetcher);
    const result = await lookup.suggest("50", session, signal());
    expect(result.map(({ placeId: id }) => id)).toEqual(["A", "B", "C", "D", "E"]);
    await expect(lookup.suggest("50", session, signal())).resolves.toEqual([]);
  });

  it.each([
    { regionCode: "US" },
    { regionCode: undefined },
    { administrativeArea: "ZZ" },
    { postalCode: "90210" },
    { postalCode: "D1D 1D1" },
    { locality: undefined },
    { addressLines: ["Example Street"] },
    { addressLines: ["50"] },
    { addressLines: ["50 Example\nStreet"] },
    { addressLines: ["50 Example Street", "Unit 1", "Unit 2"] },
  ])("does not fill an incomplete or out-of-country postal result (%j)", async (change) => {
    const fetcher = fetchStub().mockResolvedValueOnce(
      json({ postalAddress: { ...postalAddress, ...change } }),
    );
    const lookup = new CommerceAddressLookup(key, fetcher);
    await expect(lookup.resolve(placeId, session, signal())).rejects.toMatchObject(incomplete);
  });

  it("does not call upstream with an invalid place path or session token", async () => {
    const fetcher = fetchStub();
    const lookup = new CommerceAddressLookup(key, fetcher);
    for (const id of ["..", "../other", "%2e%2e", "a?key=secret", "a/places"]) {
      await expect(lookup.resolve(id, session, signal())).rejects.toMatchObject({ status: 400 });
    }
    await expect(lookup.suggest("50", "oversized!".repeat(5), signal())).rejects.toMatchObject({
      status: 400,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not call upstream with a missing or unusable API key", async () => {
    const fetcher = fetchStub();
    for (const invalid of ["", "\nsecret", "secret\n"])
      await expect(
        new CommerceAddressLookup(invalid, fetcher).suggest("50", session, signal()),
      ).rejects.toMatchObject(unavailable);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sanitizes transport, non-OK, redirect and malformed replies without returning fake no-match", async () => {
    const fetcher = fetchStub()
      .mockRejectedValueOnce(new Error(`Synthetic upstream message ${key}`))
      .mockResolvedValueOnce(json({ error: { message: key } }, 403))
      .mockResolvedValueOnce(Response.redirect("https://outside.test"))
      .mockResolvedValueOnce(new Response("{"))
      .mockResolvedValueOnce(json({ suggestions: "invalid" }))
      .mockResolvedValueOnce(json({ suggestions: [prediction("..", key)] }))
      .mockResolvedValueOnce(new Response("x".repeat(64 * 1024 + 1)));
    const lookup = new CommerceAddressLookup(key, fetcher);
    for (let i = 0; i < 7; i++) {
      await expect(lookup.suggest("50", session, signal())).rejects.toMatchObject({
        ...unavailable,
        message: "Address lookup is unavailable.",
      });
    }
    expect(fetcher).toHaveBeenCalledTimes(7);
  });

  it("propagates caller abort and passes a bounded timeout to the provider", async () => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetcher = fetchStub().mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          }),
        ),
    );
    try {
      const lookup = new CommerceAddressLookup(key, fetcher);
      const aborted = new AbortController();
      aborted.abort();
      await expect(lookup.suggest("50", session, aborted.signal)).rejects.toHaveProperty(
        "name",
        "AbortError",
      );
      expect(fetcher).not.toHaveBeenCalled();
      const pending = lookup.suggest("50", session, caller.signal);
      const pendingCheck = expect(pending).rejects.toHaveProperty("name", "AbortError");
      caller.abort();
      await pendingCheck;
      const slow = lookup.suggest("50", session, signal());
      const slowCheck = expect(slow).rejects.toMatchObject(unavailable);
      expect(timeout).toHaveBeenCalledWith(5000);
      deadline.abort(new DOMException("private timeout reason", "TimeoutError"));
      await slowCheck;
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
    }
  });
});

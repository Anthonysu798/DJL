/**
 * Web search and page contents through Exa (https://exa.ai). Exa fetches the
 * pages on its side, so a search or a page read never opens a connection from
 * our network to the target. The fake answers deterministically for tests and
 * DJL_MOCK_EXTERNALS.
 */
export interface WebResult {
  readonly url: string;
  readonly title: string | null;
  readonly publishedDate: string | null;
  readonly text: string;
}

export interface WebSearch {
  readonly search: (query: string, signal: AbortSignal) => Promise<readonly WebResult[]>;
  /** The page's text, or null when Exa has none. */
  readonly contents: (url: string, signal: AbortSignal) => Promise<WebResult | null>;
}

const SEARCH_RESULTS = 6;
const SNIPPET_CHARS = 1_200;
const PAGE_CHARS = 20_000;

export function createExaClient(options: {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}): WebSearch {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? "https://api.exa.ai";
  async function post(path: string, body: unknown, signal: AbortSignal) {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "x-api-key": options.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok) throw new Error(`exa ${path} ${response.status}`);
    const json = (await response.json()) as {
      results?: {
        url?: string;
        title?: string | null;
        publishedDate?: string | null;
        text?: string;
      }[];
    };
    return (json.results ?? []).flatMap((r) =>
      r.url
        ? [
            {
              url: r.url,
              title: r.title ?? null,
              publishedDate: r.publishedDate ?? null,
              text: r.text ?? "",
            },
          ]
        : [],
    );
  }
  return {
    search: (query, signal) =>
      post(
        "/search",
        {
          query,
          type: "auto",
          numResults: SEARCH_RESULTS,
          contents: { text: { maxCharacters: SNIPPET_CHARS } },
        },
        signal,
      ),
    async contents(url, signal) {
      const [page] = await post(
        "/contents",
        { urls: [url], text: { maxCharacters: PAGE_CHARS } },
        signal,
      );
      return page?.text ? page : null;
    },
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Deterministic stand-in: three results per query, and a page for any URL. */
export function createFakeWebSearch(): WebSearch & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async search(query) {
      calls.push(`search:${query}`);
      return [1, 2, 3].map((n) => ({
        url: `https://example.com/${slug(query)}/${n}`,
        title: `Result ${n} for ${query}`,
        publishedDate: null,
        text: `Snippet ${n} about ${query}.`,
      }));
    },
    async contents(url) {
      calls.push(`contents:${url}`);
      return { url, title: `Page at ${url}`, publishedDate: null, text: `The text of ${url}.` };
    },
  };
}

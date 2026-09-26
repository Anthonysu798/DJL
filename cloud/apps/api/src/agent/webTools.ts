/**
 * web_search and read_page. read_page obeys the provenance rule: it reads
 * only URLs that this run's searches returned or that the user wrote in their
 * own messages, so injected text cannot steer the agent to arbitrary hosts.
 * When Exa has no text for a page, the page is fetched directly through
 * safeFetch (SSRF-safe, 2 MB, 10 s).
 */
import { safeFetch } from "../net/safeFetch.ts";
import type { WebResult, WebSearch } from "./exa.ts";
import { ToolError, truncate, type AgentTool } from "./tools.ts";

/** Canonical form used for provenance checks. */
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** URLs written in text (the user's messages). */
export function urlsIn(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"')\]]+/g), (m) => normalizeUrl(m[0])).filter(
    (u): u is string => u !== null,
  );
}

const oneLine = (s: string) => s.replaceAll(/\s+/g, " ").trim();

/** The web_search result text; `URL:` lines are what provenance and citations read back. */
export function formatResults(results: readonly WebResult[]): string {
  if (results.length === 0) return "No results.";
  return results
    .map((r, i) =>
      [
        `[${i + 1}] ${oneLine(r.title ?? "Untitled")}`,
        `URL: ${r.url}`,
        ...(r.publishedDate ? [`Published: ${r.publishedDate}`] : []),
        oneLine(r.text),
      ].join("\n"),
    )
    .join("\n\n");
}

/** Search results (url → title) found in a web_search result's text. */
export function resultsIn(content: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of content.matchAll(/^\[\d+\] (.*)\nURL: (\S+)$/gm)) {
    const url = normalizeUrl(m[2]!);
    if (url) found.set(url, m[1]!);
  }
  return found;
}

function htmlToText(html: string): string {
  return html
    .replaceAll(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replaceAll(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&nbsp;/g, " ")
    .replaceAll(/&amp;/g, "&")
    .replaceAll(/&lt;/g, "<")
    .replaceAll(/&gt;/g, ">")
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&#39;/g, "'")
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function createWebTools(web: WebSearch): AgentTool[] {
  const webSearch: AgentTool = {
    name: "web_search",
    description:
      "Search the web. Returns titles, URLs, and short snippets. Use read_page on a result URL for the full text.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for.", maxLength: 400 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    quota: 15,
    async run(args, ctx) {
      const results = await ctx.charge("exa_search", 1, async () => ({
        value: await web.search(String(args.query), ctx.signal),
        units: 1,
      }));
      return { content: formatResults(results) };
    },
  };

  const readPage: AgentTool = {
    name: "read_page",
    description:
      "Read the text of a web page. Only URLs from your web_search results or from the user's messages can be read.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The page URL, exactly as given.", maxLength: 2000 },
      },
      required: ["url"],
      additionalProperties: false,
    },
    quota: 20,
    async run(args, ctx) {
      const url = normalizeUrl(String(args.url));
      if (!url || !ctx.allowedUrls.has(url))
        throw new ToolError(
          "This URL did not come from your search results or the user's messages, so it cannot be read.",
        );
      const page = await ctx.charge("exa_contents", 1, async () => ({
        value: await web.contents(url, ctx.signal),
        units: 1,
      }));
      if (page)
        return {
          content: truncate(`${page.title ? `${oneLine(page.title)}\n\n` : ""}${page.text}`),
        };
      const direct = await safeFetch(url, { signal: ctx.signal });
      const text = new TextDecoder().decode(direct.body);
      return {
        content: truncate(direct.contentType.includes("html") ? htmlToText(text) : text),
      };
    },
  };

  return [webSearch, readPage];
}

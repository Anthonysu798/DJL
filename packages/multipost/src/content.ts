import { marked } from "marked";
export interface NormalizedContent {
  title: string;
  content: string;
  description: string;
  htmlContent: string;
  markdownContent: string;
  images: unknown[];
  videos: unknown[];
  tags: string[];
}
/** Defaults are empty, never fabricated assets or transcripts. */
export function normalizeContent<
  T extends {
    title: string;
    content?: string;
    description?: string;
    htmlContent?: string;
    markdownContent?: string;
    images?: unknown[];
    videos?: unknown[];
    tags?: string[];
  },
>(kind: string, data: T): T & NormalizedContent {
  const htmlContent =
    kind === "article" && !data.htmlContent && data.markdownContent
      ? marked.parse(data.markdownContent, { async: false })
      : (data.htmlContent ?? "");
  return {
    ...data,
    content: data.content ?? "",
    description: data.description ?? "",
    htmlContent,
    markdownContent: data.markdownContent ?? "",
    images: data.images ?? [],
    videos: data.videos ?? [],
    tags: data.tags ?? [],
  };
}

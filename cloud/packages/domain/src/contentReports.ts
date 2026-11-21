/**
 * Reports of offensive or wrong AI answers. A "cloud" report names a DJL Cloud
 * message the server snapshots; a "desktop" report carries the answer text from
 * the user's own paired Mac, which the server never saw.
 */

/** Per reporter (user, else hashed IP). */
export const CONTENT_REPORT_LIMITS = [
  { windowSeconds: 60, limit: 10 },
  { windowSeconds: 24 * 60 * 60, limit: 50 },
] as const;

export interface ContentReportFields {
  readonly source: "cloud" | "desktop";
  readonly conversationId?: string | undefined;
  readonly messageId?: string | undefined;
  readonly text?: string | undefined;
  readonly agent?: string | undefined;
}

/** Why the fields do not fit the source, or null when they do. */
export function contentReportFieldError(input: ContentReportFields): string | null {
  if (input.source === "cloud") {
    if (input.text !== undefined || input.agent !== undefined)
      return "text and agent are only for desktop reports.";
    if (input.conversationId === undefined || input.messageId === undefined)
      return "conversationId and messageId are required for cloud reports.";
    return null;
  }
  if (input.conversationId !== undefined || input.messageId !== undefined)
    return "conversationId and messageId are only for cloud reports.";
  if (input.text === undefined) return "text is required for desktop reports.";
  return null;
}

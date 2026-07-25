import type {
  BrowserAnnotationAdjustments,
  BrowserAnnotationRect,
  BrowserFindingDraft,
  BrowserFindingPromptEntry,
} from "@synara/contracts";
import { BrowserFindingsPromptPayload } from "@synara/contracts";
import { Schema } from "effect";

export const BROWSER_FINDINGS_BLOCK_VERSION = 1 as const;
export const BROWSER_FINDINGS_OPEN_TAG = "<browser_findings>";
export const BROWSER_FINDINGS_CLOSE_TAG = "</browser_findings>";

export const BROWSER_ADJUSTMENT_STYLE_PROPERTIES = Object.freeze({
  color: "color",
  backgroundColor: "background-color",
  opacity: "opacity",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  textAlign: "text-align",
  margin: "margin",
  padding: "padding",
  gap: "gap",
  borderRadius: "border-radius",
} satisfies Record<Exclude<keyof BrowserAnnotationAdjustments, "textContent">, string>);

export function clampAnnotationRect(
  rect: BrowserAnnotationRect,
  viewport: Pick<BrowserAnnotationRect, "width" | "height">,
): BrowserAnnotationRect {
  const x = Math.max(0, Math.min(viewport.width, rect.x));
  const y = Math.max(0, Math.min(viewport.height, rect.y));
  return {
    x,
    y,
    width: Math.max(0, Math.min(viewport.width - x, rect.width)),
    height: Math.max(0, Math.min(viewport.height - y, rect.height)),
  };
}

function escapeMachineJson(json: string): string {
  return json.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}

export function serializeBrowserFindings(findings: readonly BrowserFindingDraft[]): string {
  const payload = {
    version: BROWSER_FINDINGS_BLOCK_VERSION,
    findings: findings.map(({ imageId: _imageId, ...finding }) => finding),
  };
  return `${BROWSER_FINDINGS_OPEN_TAG}${escapeMachineJson(JSON.stringify(payload))}${BROWSER_FINDINGS_CLOSE_TAG}`;
}

export function appendBrowserFindingsBlock(
  prompt: string,
  findings: readonly BrowserFindingDraft[],
): string {
  if (findings.length === 0) return prompt;
  const separator = prompt.trim().length > 0 ? "\n\n" : "";
  return `${prompt}${separator}${serializeBrowserFindings(findings)}`;
}

export function parseBrowserFindingsBlock(text: string): {
  visibleText: string;
  findings: BrowserFindingPromptEntry[];
} {
  const trimmedEnd = text.trimEnd();
  if (!trimmedEnd.endsWith(BROWSER_FINDINGS_CLOSE_TAG)) {
    return { visibleText: text, findings: [] };
  }
  const closeIndex = trimmedEnd.length - BROWSER_FINDINGS_CLOSE_TAG.length;
  const openIndex = trimmedEnd.lastIndexOf(BROWSER_FINDINGS_OPEN_TAG, closeIndex);
  if (openIndex < 0) return { visibleText: text, findings: [] };
  const raw = trimmedEnd.slice(openIndex + BROWSER_FINDINGS_OPEN_TAG.length, closeIndex);
  try {
    const parsed = Schema.decodeUnknownSync(BrowserFindingsPromptPayload)(JSON.parse(raw));
    const visibleEnd =
      text.slice(Math.max(0, openIndex - 2), openIndex) === "\n\n" ? openIndex - 2 : openIndex;
    return {
      visibleText: text.slice(0, visibleEnd).trimEnd(),
      findings: [...parsed.findings],
    };
  } catch {
    return { visibleText: text, findings: [] };
  }
}

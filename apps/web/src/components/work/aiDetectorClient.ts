// FILE: aiDetectorClient.ts
// Purpose: Local NDJSON transport and safe report export for AI Writing Check.

import {
  AiDetectorAnalysisEvent,
  type AiDetectorLanguagePreference,
  type AiDetectorRegionLabel,
  type AiDetectorReport,
} from "@synara/contracts";
import { isLoopbackUrl } from "@synara/shared/loopback";
import { Schema } from "effect";

import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";
import { formatLocaleDateTime, formatLocaleNumber } from "~/i18n/intl";

export const DETECTOR_MODEL_LANGUAGES = ["en", "zh-Hans"] as const;

const decodeEvent = Schema.decodeUnknownSync(AiDetectorAnalysisEvent);

export class AiDetectorAnalysisError extends Error {
  override readonly name = "AiDetectorAnalysisError";

  constructor(
    readonly code: Extract<AiDetectorAnalysisEvent, { type: "error" }>["code"],
    message: string,
  ) {
    super(message);
  }
}

export interface AiDetectorDocumentInput {
  readonly data: string | File;
  readonly languagePreference: AiDetectorLanguagePreference;
}

export async function analyzeWriting(input: {
  readonly document: AiDetectorDocumentInput;
  readonly signal: AbortSignal;
  readonly onEvent: (event: AiDetectorAnalysisEvent) => void;
}): Promise<AiDetectorReport> {
  const endpoint = resolveWsHttpUrl("/api/ai-detector/analyze");
  if (!isLoopbackUrl(endpoint)) {
    throw new AiDetectorAnalysisError(
      "local-only",
      "AI Writing Check is available only when DJL is running on this device.",
    );
  }
  const body = input.document.data;
  const file = typeof body === "string" ? null : body;
  const mediaType = file ? file.type || "application/octet-stream" : "text/plain;charset=utf-8";
  const headers: Record<string, string> = {
    "Content-Type": mediaType,
    "X-DJL-AI-Detector-Language": input.document.languagePreference,
  };
  if (file) headers["X-DJL-Filename"] = encodeURIComponent(file.name);
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body,
    signal: input.signal,
  });
  if (!response.ok) {
    const detail = (await response.text()).trim().slice(0, 1_000);
    const code =
      response.status === 400 || response.status === 413
        ? "invalid-input"
        : response.status === 415
          ? "unsupported-format"
          : response.status === 403
            ? "local-only"
            : "analysis-failed";
    throw new AiDetectorAnalysisError(
      code,
      detail || `Local analysis failed (${response.status}).`,
    );
  }
  if (!response.body) throw new Error("The local analysis stream was unavailable.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let report: AiDetectorReport | null = null;
  let streamCompleted = false;
  const parseLine = (line: string) => {
    if (!line.trim()) return;
    const event = decodeEvent(JSON.parse(line));
    input.onEvent(event);
    if (event.type === "error") throw new AiDetectorAnalysisError(event.code, event.message);
    if (event.type === "result") report = event.report;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        parseLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    parseLine(buffer);
    streamCompleted = true;
  } finally {
    if (!streamCompleted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!report) throw new Error("The local analysis ended without a result.");
  return report;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface AiDetectorReportExportCopy {
  readonly title: string;
  readonly privacy: string;
  readonly methodology: string;
  readonly disclaimer: string;
  readonly assessment: string;
  readonly confidenceLabel: string;
  readonly confidence: string;
  readonly likelyAi: string;
  readonly uncertain: string;
  readonly likelyHuman: string;
  readonly eligible: string;
  readonly excluded: string;
  readonly evidence: string;
  readonly technicalDetails: string;
  readonly analyzedText: string;
  readonly preprocessing: string;
  readonly segmentation: string;
  readonly digest: string;
  readonly regionLabels: Readonly<Record<AiDetectorRegionLabel, string>>;
  readonly exclusionLabels: Readonly<Record<string, string>>;
}

export interface AiDetectorReportExportOptions {
  readonly includeText: boolean;
  readonly reportLanguage: string;
  readonly generatedAt: string;
  readonly copy: AiDetectorReportExportCopy;
}

function createExportPayload(report: AiDetectorReport, options: AiDetectorReportExportOptions) {
  const payload = {
    schemaVersion: 1,
    reportLanguage: options.reportLanguage,
    generatedAt: options.generatedAt,
    detectorVersion: `${report.preprocessingVersion}/${report.segmentationVersion}`,
    method: options.copy.methodology,
    privacy: options.copy.privacy,
    disclaimer: options.copy.disclaimer,
    summary: {
      assessmentCode: report.assessment,
      assessment: options.copy.assessment,
      confidenceCode: report.confidence,
      confidence: options.copy.confidence,
      coverage: {
        likelyAi: report.scores.likelyAi,
        uncertain: report.scores.uncertain,
        likelyHuman: report.scores.likelyHuman,
      },
      coverageLabels: {
        likelyAi: options.copy.likelyAi,
        uncertain: options.copy.uncertain,
        likelyHuman: options.copy.likelyHuman,
      },
      eligibleCharacters: report.eligibleCharacters,
      excludedCharacters: report.excludedCharacters,
      totalCharacters: report.totalCharacters,
    },
    passages: report.regions.map((region) => ({
      start: region.start,
      end: region.end,
      label: options.copy.regionLabels[region.label],
      detectorLabel: region.label,
      language: region.language,
      ...(region.score === undefined ? {} : { score: region.score }),
      ...(region.reason
        ? { exclusion: options.copy.exclusionLabels[region.reason] ?? region.reason }
        : {}),
    })),
    models: report.modelRuns.map((run) => ({
      language: run.language,
      id: run.model,
      revision: run.revision,
      modelHash: run.modelSha256.slice(0, 12),
      calibrationVersion: run.calibrationVersion,
      passages: run.passages,
    })),
    preprocessingVersion: report.preprocessingVersion,
    segmentationVersion: report.segmentationVersion,
    contentDigest: report.contentHash,
    ...(options.includeText ? { analyzedText: report.normalizedText } : {}),
  } as const;
  return payload;
}

export function serializeAiDetectorJsonReport(
  report: AiDetectorReport,
  options: AiDetectorReportExportOptions,
): string {
  return `${JSON.stringify(createExportPayload(report, options), null, 2)}\n`;
}

export function renderAiDetectorHtmlReport(
  report: AiDetectorReport,
  options: AiDetectorReportExportOptions,
): string {
  const payload = createExportPayload(report, options);
  const copy = options.copy;
  const modelRows = report.modelRuns
    .map(
      (run) =>
        `<tr><td>${escapeHtml(run.language)}</td><td>${escapeHtml(run.model)}</td><td><code>${escapeHtml(run.revision)}</code></td><td><code>${escapeHtml(run.modelSha256.slice(0, 12))}</code></td><td>${escapeHtml(run.calibrationVersion)}</td></tr>`,
    )
    .join("");
  const passageRows = report.regions
    .map((region) => {
      const reason = region.reason ? (copy.exclusionLabels[region.reason] ?? region.reason) : "";
      const score = region.score === undefined ? "—" : `${Math.round(region.score * 100)}%`;
      return `<tr><td>${region.start}–${region.end}</td><td>${escapeHtml(copy.regionLabels[region.label])}</td><td>${escapeHtml(region.language)}</td><td>${score}</td><td>${escapeHtml(reason)}</td></tr>`;
    })
    .join("");
  const textSection = options.includeText
    ? `<h2>${escapeHtml(copy.analyzedText)}</h2><pre>${escapeHtml(report.normalizedText)}</pre>`
    : "";
  return `<!doctype html>
<html lang="${escapeHtml(options.reportLanguage)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(copy.title)}</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#171717}h1,h2{line-height:1.2}time,.muted{color:#666}.scores{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.score{border:1px solid #ccc;border-radius:10px;padding:16px}.score strong{display:block;font-size:2rem}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px;border-radius:8px}.notice{border-left:4px solid #b7791f;padding:8px 12px;background:#fffaf0}@media(max-width:640px){.scores{grid-template-columns:1fr}table{display:block;overflow-x:auto}}</style></head>
<body><h1>${escapeHtml(copy.title)}</h1><time datetime="${escapeHtml(options.generatedAt)}">${escapeHtml(formatLocaleDateTime(options.generatedAt, options.reportLanguage, { dateStyle: "medium", timeStyle: "medium" }))}</time><p>${escapeHtml(copy.privacy)}</p><p class="notice">${escapeHtml(copy.disclaimer)}</p>
<div class="scores"><div class="score">${escapeHtml(copy.likelyAi)}<strong>${report.scores.likelyAi}%</strong></div><div class="score">${escapeHtml(copy.uncertain)}<strong>${report.scores.uncertain}%</strong></div><div class="score">${escapeHtml(copy.likelyHuman)}<strong>${report.scores.likelyHuman}%</strong></div></div>
<p><strong>${escapeHtml(copy.assessment)}</strong> · ${escapeHtml(copy.confidenceLabel)}: <strong>${escapeHtml(copy.confidence)}</strong></p>
<p>${escapeHtml(copy.eligible)}: ${formatLocaleNumber(report.eligibleCharacters, options.reportLanguage)} · ${escapeHtml(copy.excluded)}: ${formatLocaleNumber(report.excludedCharacters, options.reportLanguage)}</p>
<h2>${escapeHtml(copy.evidence)}</h2><table><tbody>${passageRows}</tbody></table>
<h2>${escapeHtml(copy.technicalDetails)}</h2><p>${escapeHtml(copy.methodology)}</p><table><tbody>${modelRows}</tbody></table>
<p>${escapeHtml(copy.preprocessing)}: <code>${escapeHtml(payload.preprocessingVersion)}</code><br>${escapeHtml(copy.segmentation)}: <code>${escapeHtml(payload.segmentationVersion)}</code><br>${escapeHtml(copy.digest)}: <code>${escapeHtml(payload.contentDigest)}</code></p>
${textSection}</body></html>`;
}

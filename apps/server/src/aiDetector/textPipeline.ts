// FILE: textPipeline.ts
// Purpose: Deterministic, explainable preprocessing and aggregation for AI Writing Check.

import type {
  AiDetectorLanguage,
  AiDetectorLanguagePreference,
  AiDetectorRegion,
  AiDetectorRegionLabel,
  AiDetectorScoreSummary,
} from "@synara/contracts";

import { getModelManifest, type DetectorModelLanguage } from "./modelManifest";

export const AI_DETECTOR_PREPROCESSING_VERSION = "djl-prose-v2";
export const AI_DETECTOR_SEGMENTATION_VERSION = "djl-passages-v3";
export const MIN_ELIGIBLE_CHARACTERS = 120;
export const ENGLISH_LIKELY_AI_MIN_ELIGIBLE_CHARACTERS = 600;

export interface NormalizedText {
  readonly text: string;
  readonly sourceOffsets: readonly number[];
}

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface RoutedSpan extends TextSpan {
  readonly language: AiDetectorLanguage;
  readonly excludedReason?: string;
}

export interface DetectorPassage extends TextSpan {
  readonly id: string;
  readonly language: DetectorModelLanguage;
  readonly text: string;
}

export interface ScoredPassage extends DetectorPassage {
  readonly aiProbability: number;
}

export interface AggregatedTextResult {
  readonly scores: AiDetectorScoreSummary;
  readonly regions: readonly AiDetectorRegion[];
  readonly eligibleCharacters: number;
  readonly excludedCharacters: number;
  readonly assessment: "likely-ai" | "mixed" | "likely-human" | "insufficient" | "unsupported";
  readonly confidence: "low" | "medium" | "high";
}

function normalizeUnit(unit: string): string {
  if (unit === "\r") return "\n";
  if (unit === "\n" || unit === "\t") return unit;
  return unit.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "");
}

export function normalizeWithOffsets(source: string): NormalizedText {
  let text = "";
  const sourceOffsets: number[] = [0];
  const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(source);
  for (const { segment, index } of graphemes) {
    const end = index + segment.length;
    const normalized = segment === "\r\n" ? "\n" : normalizeUnit(segment);
    text += normalized;
    for (let produced = 0; produced < normalized.length; produced += 1) {
      sourceOffsets.push(end);
    }
  }
  return { text, sourceOffsets };
}

export function classifyParagraphLanguage(text: string): AiDetectorLanguage {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []).length;
  const hangul = (text.match(/\p{Script=Hangul}/gu) ?? []).length;
  if (kana > 0 || hangul > 0) return "unsupported";
  const simplified = (text.match(/[这为与发后台里体国学书写简门语处过还内检测于]/gu) ?? []).length;
  const traditional = (text.match(/[這為與發後臺裡體國學書寫簡門語處過還內檢測於]/gu) ?? []).length;
  if (traditional >= 2 && traditional > simplified) return "unsupported";
  if (han >= 2 && han >= latin * 0.35) return "zh-Hans";
  if (latin >= 4 && latin > han) return "en";
  return "unsupported";
}

function exclusionReason(line: string, inCode: boolean, inReferences: boolean): string | null {
  const trimmed = line.trim();
  if (!trimmed) return "blank";
  if (inCode || /^```|^~~~/.test(trimmed)) return "code";
  if (inReferences) return "references";
  if (/^(references|bibliography|works cited|参考文献|引用文献)\s*:?[\s]*$/i.test(trimmed)) {
    return "references";
  }
  if (trimmed.startsWith(">") || /^[“"].*[”"]$/.test(trimmed)) return "quotation";
  if (/^\|.*\|$/.test(trimmed) || /^[-:| ]{5,}$/.test(trimmed)) return "table";
  if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(trimmed) && trimmed.length < 140) return "list";
  if (/^#{1,6}\s+/.test(trimmed)) return "heading";
  if (trimmed.length < 45 && !/[.!?。！？]$/.test(trimmed)) return "metadata";
  return null;
}

function mixedLanguageSentenceSpans(line: string, lineStart: number): readonly TextSpan[] {
  const hasEnglish = (line.match(/\p{Script=Latin}/gu) ?? []).length >= 4;
  const hasChinese = (line.match(/\p{Script=Han}/gu) ?? []).length >= 2;
  if (!hasEnglish || !hasChinese) {
    return [{ start: lineStart, end: lineStart + line.length }];
  }

  const spans: TextSpan[] = [];
  let segmentStart = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (!/[.!?。！？]/u.test(line[index]!)) continue;
    let segmentEnd = index + 1;
    while (segmentEnd < line.length && /\s/u.test(line[segmentEnd]!)) segmentEnd += 1;
    if (segmentEnd > segmentStart) {
      spans.push({ start: lineStart + segmentStart, end: lineStart + segmentEnd });
    }
    segmentStart = segmentEnd;
    index = segmentEnd - 1;
  }
  if (segmentStart < line.length) {
    spans.push({ start: lineStart + segmentStart, end: lineStart + line.length });
  }
  return spans.length > 0 ? spans : [{ start: lineStart, end: lineStart + line.length }];
}

export function routeEligibleProse(
  text: string,
  preference: AiDetectorLanguagePreference,
): readonly RoutedSpan[] {
  const spans: RoutedSpan[] = [];
  let cursor = 0;
  let inCode = false;
  let inReferences = false;
  for (const line of text.split(/(?<=\n)/)) {
    const start = cursor;
    const end = start + line.length;
    cursor = end;
    const trimmed = line.trim();
    const opensFence = /^```|^~~~/.test(trimmed);
    const reason = exclusionReason(line, inCode, inReferences);
    if (/^(references|bibliography|works cited|参考文献|引用文献)\s*:?[\s]*$/i.test(trimmed)) {
      inReferences = true;
    }
    if (opensFence) inCode = !inCode;
    const candidates = reason ? [{ start, end }] : mixedLanguageSentenceSpans(line, start);
    for (const candidate of candidates) {
      let language = classifyParagraphLanguage(text.slice(candidate.start, candidate.end));
      let excludedReason = reason ?? undefined;
      if (!excludedReason && preference !== "auto" && language !== preference) {
        excludedReason = language === "unsupported" ? "unsupported-language" : "other-language";
      }
      if (!excludedReason && language === "unsupported") excludedReason = "unsupported-language";
      if (excludedReason) language = language === "unsupported" ? "unsupported" : language;
      const previous = spans.at(-1);
      if (
        previous &&
        previous.end === candidate.start &&
        previous.language === language &&
        previous.excludedReason === excludedReason
      ) {
        spans[spans.length - 1] = { ...previous, end: candidate.end };
      } else {
        spans.push({
          start: candidate.start,
          end: candidate.end,
          language,
          ...(excludedReason ? { excludedReason } : {}),
        });
      }
    }
  }
  return spans;
}

function preferredBoundary(text: string, minimum: number, maximum: number): number {
  const slice = text.slice(minimum, maximum);
  let candidate = -1;
  for (const pattern of [/\n\n/g, /[.!?。！？]\s*/g, /\s+/g]) {
    for (const match of slice.matchAll(pattern)) candidate = match.index + (match[0]?.length ?? 0);
    if (candidate >= 0) return minimum + candidate;
  }
  return maximum;
}

export function segmentPassages(
  text: string,
  routed: readonly RoutedSpan[],
): readonly DetectorPassage[] {
  const passages: DetectorPassage[] = [];
  for (const span of routed) {
    if (span.excludedReason || span.language === "unsupported") continue;
    const maxChars = span.language === "zh-Hans" ? 680 : 1_500;
    const overlap = span.language === "zh-Hans" ? 80 : 180;
    let start = span.start;
    while (start < span.end) {
      const hardEnd = Math.min(span.end, start + maxChars);
      const end = hardEnd === span.end ? hardEnd : preferredBoundary(text, start + 80, hardEnd);
      const passageText = text.slice(start, end).trim();
      if (passageText.length >= 24) {
        const leading = text.slice(start, end).indexOf(passageText);
        const actualStart = start + Math.max(0, leading);
        passages.push({
          id: `${span.language}-${actualStart}-${actualStart + passageText.length}`,
          start: actualStart,
          end: actualStart + passageText.length,
          language: span.language,
          text: passageText,
        });
      }
      if (end >= span.end) break;
      const next = Math.max(start + 1, end - overlap);
      start = next;
    }
  }
  return passages;
}

export async function segmentPassagesTokenAware(
  text: string,
  routed: readonly RoutedSpan[],
  countTokens: (
    language: DetectorModelLanguage,
    text: string,
    signal: AbortSignal,
  ) => Promise<number>,
  signal: AbortSignal,
  options: { readonly maxTokens?: number } = {},
): Promise<readonly DetectorPassage[]> {
  const maxTokens = Math.min(512, Math.max(32, options.maxTokens ?? 500));
  const passages: DetectorPassage[] = [];
  const spansByLanguage = (["en", "zh-Hans"] as const).flatMap((language) =>
    routed.filter(
      (span): span is RoutedSpan & { readonly language: DetectorModelLanguage } =>
        span.language === language && span.excludedReason === undefined,
    ),
  );

  for (const span of spansByLanguage) {
    const maxChars = span.language === "zh-Hans" ? 480 : 1_500;
    const overlap = span.language === "zh-Hans" ? 80 : 180;
    let start = span.start;

    while (start < span.end) {
      signal.throwIfAborted();
      const hardEnd = Math.min(span.end, start + maxChars);
      const preferredEnd =
        hardEnd === span.end ? hardEnd : preferredBoundary(text, start + 80, hardEnd);
      const leadingTrimmed = text.slice(start, preferredEnd).trimStart();
      const actualStart = start + (text.slice(start, preferredEnd).length - leadingTrimmed.length);
      let actualEnd = preferredEnd;
      let passageText = text.slice(actualStart, actualEnd).trimEnd();
      actualEnd = actualStart + passageText.length;
      let tokenCount =
        passageText.length > 0 ? await countTokens(span.language, passageText, signal) : 0;

      if (tokenCount > maxTokens) {
        let low = actualStart + 1;
        let high = actualEnd;
        let bestEnd = -1;
        while (low <= high) {
          signal.throwIfAborted();
          const middle = Math.floor((low + high) / 2);
          const candidate = text.slice(actualStart, middle).trimEnd();
          const candidateEnd = actualStart + candidate.length;
          const candidateTokens = await countTokens(span.language, candidate, signal);
          if (candidateTokens <= maxTokens) {
            bestEnd = candidateEnd;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        if (bestEnd <= actualStart) {
          throw new Error("The detector tokenizer could not fit this text into a model passage.");
        }
        if (bestEnd - actualStart > 80) {
          const boundary = preferredBoundary(text, actualStart + 40, bestEnd);
          if (boundary > actualStart + 24) bestEnd = boundary;
        }
        passageText = text.slice(actualStart, bestEnd).trimEnd();
        actualEnd = actualStart + passageText.length;
        tokenCount = await countTokens(span.language, passageText, signal);
      }

      if (passageText.length >= 24) {
        if (tokenCount > maxTokens) {
          throw new Error("The detector passage exceeds the installed model token limit.");
        }
        passages.push({
          id: `${span.language}-${actualStart}-${actualEnd}`,
          start: actualStart,
          end: actualEnd,
          language: span.language,
          text: passageText,
        });
      }
      // Trimming a final newline or spaces moves actualEnd before span.end even
      // though the entire meaningful span was already scored. Treat a
      // whitespace-only remainder as complete so it cannot create nested,
      // progressively shorter suffix passages.
      if (actualEnd >= span.end || text.slice(actualEnd, span.end).trim().length === 0) break;
      // A tokenizer can force a passage far below the language's normal
      // character window. Keep overlap proportional in that case; applying the
      // full fixed overlap to a similarly-sized passage can advance by only one
      // character and explode a short document into hundreds of inferences.
      const passageLength = actualEnd - actualStart;
      const effectiveOverlap = Math.min(overlap, Math.floor(passageLength / 4));
      start = Math.max(start + 1, actualEnd - effectiveOverlap);
    }
  }

  return passages;
}

export function calibrateScore(
  language: DetectorModelLanguage,
  probability: number,
): Exclude<AiDetectorRegionLabel, "excluded"> {
  const manifest = getModelManifest(language);
  if (probability <= manifest.humanThreshold) return "likely-human";
  if (probability >= manifest.aiThreshold) return "likely-ai";
  return "uncertain";
}

function roundPercentages(counts: readonly [number, number, number]): AiDetectorScoreSummary {
  const total = counts[0] + counts[1] + counts[2];
  if (total <= 0) return { likelyAi: 0, uncertain: 0, likelyHuman: 0 };
  const raw = counts.map((count) => (count / total) * 100);
  const rounded = raw.map(Math.floor);
  let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .toSorted((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    rounded[index] = (rounded[index] ?? 0) + 1;
    remainder -= 1;
  }
  return {
    likelyAi: rounded[0] ?? 0,
    uncertain: rounded[1] ?? 0,
    likelyHuman: rounded[2] ?? 0,
  };
}

function mergeRegions(regions: readonly AiDetectorRegion[]): readonly AiDetectorRegion[] {
  const merged: AiDetectorRegion[] = [];
  for (const region of regions) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.end === region.start &&
      previous.label === region.label &&
      previous.language === region.language &&
      previous.reason === region.reason &&
      previous.score === region.score
    ) {
      merged[merged.length - 1] = { ...previous, end: region.end };
    } else {
      merged.push(region);
    }
  }
  return merged;
}

export function aggregateReport(input: {
  readonly text: string;
  readonly routed: readonly RoutedSpan[];
  readonly passages: readonly ScoredPassage[];
}): AggregatedTextResult {
  const excludedRegions: AiDetectorRegion[] = input.routed
    .filter((span) => span.excludedReason !== undefined)
    .map((span) => ({
      start: span.start,
      end: span.end,
      label: "excluded",
      language: span.language,
      reason: span.excludedReason,
    }));
  const eligibleSpans = input.routed.filter((span) => span.excludedReason === undefined);
  const englishEligibleCharacters = eligibleSpans
    .filter((span) => span.language === "en")
    .reduce((total, span) => total + Math.max(0, span.end - span.start), 0);
  const scoredRegions: AiDetectorRegion[] = [];
  const counts: [number, number, number] = [0, 0, 0];

  for (const eligible of eligibleSpans) {
    const relevant = input.passages.filter(
      (passage) =>
        passage.language === eligible.language &&
        passage.end > eligible.start &&
        passage.start < eligible.end,
    );
    const boundaries = new Set([eligible.start, eligible.end]);
    for (const passage of relevant) {
      boundaries.add(Math.max(eligible.start, passage.start));
      boundaries.add(Math.min(eligible.end, passage.end));
    }
    const ordered = [...boundaries].toSorted((left, right) => left - right);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index] ?? eligible.start;
      const end = ordered[index + 1] ?? eligible.end;
      if (end <= start || input.text.slice(start, end).trim().length === 0) continue;
      const covering = relevant.filter((passage) => passage.start <= start && passage.end >= end);
      const score =
        covering.length > 0
          ? covering.reduce((sum, passage) => sum + passage.aiProbability, 0) / covering.length
          : 0.5;
      const language = eligible.language as DetectorModelLanguage;
      const calibrated = covering.length > 0 ? calibrateScore(language, score) : "uncertain";
      const label =
        calibrated === "likely-ai" &&
        language === "en" &&
        englishEligibleCharacters < ENGLISH_LIKELY_AI_MIN_ELIGIBLE_CHARACTERS
          ? "uncertain"
          : calibrated;
      const length = end - start;
      if (label === "likely-ai") counts[0] += length;
      else if (label === "uncertain") counts[1] += length;
      else counts[2] += length;
      scoredRegions.push({ start, end, label, language, score });
    }
  }

  const eligibleCharacters = counts[0] + counts[1] + counts[2];
  const excludedCharacters = excludedRegions.reduce(
    (total, region) => total + Math.max(0, region.end - region.start),
    0,
  );
  const scores = roundPercentages(counts);
  const hasUnsupportedLanguage = excludedRegions.some(
    (region) => region.reason === "unsupported-language",
  );
  const assessment =
    eligibleCharacters === 0
      ? hasUnsupportedLanguage
        ? "unsupported"
        : "insufficient"
      : eligibleCharacters < MIN_ELIGIBLE_CHARACTERS
        ? "insufficient"
        : scores.likelyAi >= 65
          ? "likely-ai"
          : scores.likelyHuman >= 65
            ? "likely-human"
            : "mixed";
  const confidence =
    eligibleCharacters < 300 || scores.uncertain >= 45
      ? "low"
      : eligibleCharacters >= 1_000 && scores.uncertain <= 20
        ? "high"
        : "medium";
  return {
    scores,
    regions: mergeRegions(
      [...scoredRegions, ...excludedRegions].toSorted((a, b) => a.start - b.start),
    ),
    eligibleCharacters,
    excludedCharacters,
    assessment,
    confidence,
  };
}

#!/usr/bin/env bun
// Verifies deterministic, network-blocked inference against already-installed local models.

import path from "node:path";

import { DetectorModelRuntime } from "../../apps/server/src/aiDetector/modelRuntime";
import {
  aggregateReport,
  calibrateScore,
  routeEligibleProse,
  segmentPassagesTokenAware,
} from "../../apps/server/src/aiDetector/textPipeline";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name} argument.`);
  return value;
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

const stateDir = argument("--state-dir");
const runtime = new DetectorModelRuntime(path.join(stateDir, "ai-detector", "models"));
const controller = new AbortController();
const english =
  "The university library is more than a repository of books. It is a shared civic space where students compare sources, test interpretations, and learn how evidence changes a conclusion. Responsible research takes time because each claim must be traced to reliable material and considered in context.";
const chinese =
  "大学图书馆不仅是收藏书籍的地方，也是学生共同学习和交流观点的公共空间。学生在这里比较资料来源，检验不同解释，并理解证据如何改变结论。负责任的研究需要时间，因为每一项论述都应追溯到可靠材料，并结合具体语境加以判断。";

let blockedNetworkAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  blockedNetworkAttempts += 1;
  throw new Error("Outbound network is blocked during detector verification.");
}) as typeof fetch;

try {
  const englishScores: number[] = [];
  const chineseScores: number[] = [];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    englishScores.push(await runtime.score("en", english, controller.signal));
  }
  for (let iteration = 0; iteration < 20; iteration += 1) {
    chineseScores.push(await runtime.score("zh-Hans", chinese, controller.signal));
  }

  const mixedText = `${english}\n${chinese}\n`;
  const routed = routeEligibleProse(mixedText, "auto");
  const mixedPassages = await segmentPassagesTokenAware(
    mixedText,
    routed,
    (language, text, signal) => runtime.countTokens(language, text, signal),
    controller.signal,
  );
  const mixedSignatures = Array.from({ length: 20 }, (_value, iteration) => {
    const passages = mixedPassages.map((passage) =>
      Object.assign({}, passage, {
        aiProbability:
          passage.language === "en"
            ? (englishScores[iteration] ?? englishScores[0]!)
            : (chineseScores[iteration] ?? chineseScores[0]!),
      }),
    );
    const report = aggregateReport({ text: mixedText, routed, passages });
    return JSON.stringify({
      scores: report.scores,
      assessment: report.assessment,
      confidence: report.confidence,
      regions: report.regions,
    });
  });

  const tolerance = 1e-12;
  const result = {
    schemaVersion: 2,
    iterationsPerLanguage: 20,
    executionProvider: "cpu",
    outboundNetworkBlocked: true,
    blockedNetworkAttempts,
    tolerance,
    english: {
      score: englishScores[0],
      spread: spread(englishScores),
      eligibleCharacters: english.length,
      classification: calibrateScore("en", englishScores[0]!, english.length),
    },
    simplifiedChinese: {
      score: chineseScores[0],
      spread: spread(chineseScores),
      eligibleCharacters: chinese.length,
      classification: calibrateScore("zh-Hans", chineseScores[0]!, chinese.length),
    },
    mixed: {
      uniqueDisplayedReports: new Set(mixedSignatures).size,
      report: JSON.parse(mixedSignatures[0]!),
    },
  };

  if (
    blockedNetworkAttempts !== 0 ||
    result.english.spread > tolerance ||
    result.simplifiedChinese.spread > tolerance ||
    result.mixed.uniqueDisplayedReports !== 1
  ) {
    throw new Error(`Runtime verification failed: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  globalThis.fetch = originalFetch;
  await runtime.dispose();
}

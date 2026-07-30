import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const BENCHMARK_SPLIT_ROLES = ["development", "validation", "locked"] as const;

export type BenchmarkSplitRole = (typeof BENCHMARK_SPLIT_ROLES)[number];

export interface BenchmarkFixture {
  readonly id: string;
  readonly language: "en" | "zh-Hans";
  readonly label: "ai" | "human" | "ai-refined";
  readonly text: string;
  readonly provenance: string;
  readonly license: string;
  readonly splitRole?: BenchmarkSplitRole;
  readonly sourceGroupId?: string;
  readonly authorId?: string;
  readonly promptFamily?: string;
  readonly nativeLanguageCohort?: string;
  readonly scenario?: string;
  readonly domain?: string;
  readonly generator?: string;
  readonly attackEditing?: string;
}

const OPTIONAL_STRING_METADATA = [
  "sourceGroupId",
  "authorId",
  "promptFamily",
  "nativeLanguageCohort",
  "scenario",
  "domain",
  "generator",
  "attackEditing",
] as const;

const GROUPING_METADATA = ["sourceGroupId", "authorId", "promptFamily"] as const;

function canonicalMetadataValue(value: string, groupingIdentifier: boolean): string {
  const normalized = value.normalize("NFKC").trim();
  return groupingIdentifier
    ? normalized.replace(/\s+/gu, " ").toLocaleLowerCase("en-US")
    : normalized;
}

function canonicalTextFingerprint(text: string): string {
  const canonical = text.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function readBenchmarkInput(
  inputPath: string,
  readStdin: () => Promise<string> = () => Bun.stdin.text(),
): Promise<string> {
  return inputPath === "-" ? readStdin() : readFile(inputPath, "utf8");
}

export function assertBenchmarkRunSplitRole(
  fixtures: readonly BenchmarkFixture[],
  requiredSplitRole: BenchmarkSplitRole | null,
): void {
  if (requiredSplitRole !== null) {
    const mismatched = fixtures.find((fixture) => fixture.splitRole !== requiredSplitRole);
    if (mismatched) {
      throw new Error(
        `Benchmark fixture '${mismatched.id}' must explicitly declare splitRole '${requiredSplitRole}'.`,
      );
    }
    return;
  }
  if (fixtures.some((fixture) => fixture.splitRole === "locked")) {
    throw new Error("Locked benchmark fixtures require an explicit --split-role locked assertion.");
  }
}

export function parseBenchmarkInput(raw: string): BenchmarkFixture[] {
  const fixtures = raw
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      let fixture: Record<string, unknown>;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("record must be a JSON object");
        }
        fixture = parsed as Record<string, unknown>;
      } catch (error) {
        throw new Error(
          `Invalid benchmark fixture on line ${lineNumber}: ${
            error instanceof Error ? error.message : String(error)
          }.`,
          { cause: error },
        );
      }

      const requiredStrings = ["id", "text", "provenance", "license"] as const;
      const missing = requiredStrings.find(
        (key) => typeof fixture[key] !== "string" || fixture[key].trim().length === 0,
      );
      if (
        missing ||
        !["en", "zh-Hans"].includes(String(fixture.language)) ||
        !["ai", "human", "ai-refined"].includes(String(fixture.label))
      ) {
        throw new Error(
          `Benchmark fixture on line ${lineNumber} is incomplete or has an unsupported language or label.`,
        );
      }

      if (
        fixture.splitRole !== undefined &&
        !BENCHMARK_SPLIT_ROLES.includes(fixture.splitRole as BenchmarkSplitRole)
      ) {
        throw new Error(
          `Benchmark fixture '${String(fixture.id)}' has unsupported splitRole '${String(
            fixture.splitRole,
          )}'.`,
        );
      }
      for (const key of OPTIONAL_STRING_METADATA) {
        if (
          fixture[key] !== undefined &&
          (typeof fixture[key] !== "string" || fixture[key].trim().length === 0)
        ) {
          throw new Error(
            `Benchmark fixture '${String(fixture.id)}' has invalid optional metadata '${key}'.`,
          );
        }
        if (typeof fixture[key] === "string") {
          fixture[key] = canonicalMetadataValue(
            fixture[key],
            GROUPING_METADATA.includes(key as (typeof GROUPING_METADATA)[number]),
          );
        }
      }

      return fixture as unknown as BenchmarkFixture;
    });
  if (fixtures.length === 0) {
    throw new Error("Benchmark input is empty.");
  }
  const ids = fixtures.map((fixture) => fixture.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Benchmark input contains duplicate fixture ids.");
  }
  for (const key of GROUPING_METADATA) {
    const rolesByGroup = new Map<string, Set<BenchmarkSplitRole>>();
    for (const fixture of fixtures) {
      const group = fixture[key];
      if (!group || !fixture.splitRole) continue;
      const roles = rolesByGroup.get(group) ?? new Set<BenchmarkSplitRole>();
      roles.add(fixture.splitRole);
      rolesByGroup.set(group, roles);
    }
    const leaked = [...rolesByGroup].find(([, roles]) => roles.size > 1);
    if (leaked) {
      throw new Error(
        `Benchmark ${key} '${leaked[0]}' appears in multiple split roles: ${[...leaked[1]].join(
          ", ",
        )}.`,
      );
    }
  }
  const rolesByText = new Map<string, Set<BenchmarkSplitRole>>();
  for (const fixture of fixtures) {
    if (!fixture.splitRole) continue;
    const fingerprint = canonicalTextFingerprint(fixture.text);
    const roles = rolesByText.get(fingerprint) ?? new Set<BenchmarkSplitRole>();
    roles.add(fixture.splitRole);
    rolesByText.set(fingerprint, roles);
  }
  const duplicatedAcrossRoles = [...rolesByText].find(([, roles]) => roles.size > 1);
  if (duplicatedAcrossRoles) {
    throw new Error(
      `Benchmark canonical text '${duplicatedAcrossRoles[0]}' appears in multiple split roles: ${[
        ...duplicatedAcrossRoles[1],
      ].join(", ")}.`,
    );
  }
  return fixtures;
}

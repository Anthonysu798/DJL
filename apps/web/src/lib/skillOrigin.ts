// FILE: skillOrigin.ts
// Purpose: Where a composer skill comes from (DJL built-in, Claude Code, Codex, shared
//          `.agents`, a project folder) and how the `$` picker groups and orders it.
// Layer: Web composer helper

import type { ProviderKind, ProviderSkillDescriptor } from "@djl/contracts";

export type SkillOriginKind = "builtin" | "claude" | "codex" | "shared" | "djl" | "other";

export interface SkillOrigin {
  readonly kind: SkillOriginKind;
  /** The provider whose logo marks the skill; null for DJL and shared skills. */
  readonly provider: ProviderKind | null;
  /** The Claude Code plugin that ships the skill. */
  readonly plugin: string | null;
  /** Found in a project folder rather than the user's home. */
  readonly project: boolean;
}

/** Display order of the picker groups after the provider's own skills. */
export type SkillGroupKey = "suggested" | "builtin" | "claude" | "codex" | "shared" | "other";
const GROUP_ORDER: readonly SkillGroupKey[] = [
  "suggested",
  "builtin",
  "claude",
  "codex",
  "shared",
  "other",
];

const SCOPE_PROVIDER: Partial<Record<string, ProviderKind>> = {
  cursor: "cursor",
  gemini: "gemini",
  grok: "grok",
  droid: "droid",
  factory: "droid",
  kilo: "kilo",
  opencode: "opencode",
  pi: "pi",
};

function pathHasSegment(path: string, segment: string): boolean {
  return path.split(/[\\/]+/).includes(segment);
}

export function resolveSkillOrigin(
  skill: Pick<ProviderSkillDescriptor, "scope" | "path" | "plugin">,
): SkillOrigin {
  const plugin = skill.plugin ?? null;
  const base = { plugin, project: false };
  switch (skill.scope) {
    case "built-in":
      return { ...base, kind: "builtin", provider: null };
    case "claude":
      return { ...base, kind: "claude", provider: "claudeAgent" };
    case "codex":
      return { ...base, kind: "codex", provider: "codex" };
    case "agents":
      return { ...base, kind: "shared", provider: null };
    case "djl":
      return { ...base, kind: "djl", provider: null };
    case "project": {
      const project = { plugin, project: true };
      if (pathHasSegment(skill.path, ".claude"))
        return { ...project, kind: "claude", provider: "claudeAgent" };
      if (pathHasSegment(skill.path, ".codex"))
        return { ...project, kind: "codex", provider: "codex" };
      return { ...project, kind: "shared", provider: null };
    }
    default:
      return { ...base, kind: "other", provider: SCOPE_PROVIDER[skill.scope ?? ""] ?? null };
  }
}

/** Whether the selected provider loads this skill from its own folders. */
export function isSkillNativeTo(origin: SkillOrigin, provider: ProviderKind): boolean {
  switch (origin.kind) {
    case "claude":
      // Doubao and DeepSeek run on the Claude Code harness.
      return provider === "claudeAgent" || provider === "doubao" || provider === "deepseek";
    case "codex":
      return provider === "codex";
    case "shared":
      return provider === "codex" || provider === "muse";
    case "other":
      return origin.provider !== null && origin.provider === provider;
    default:
      return false;
  }
}

export function skillGroupKey(origin: SkillOrigin, provider: ProviderKind): SkillGroupKey {
  if (isSkillNativeTo(origin, provider)) return "suggested";
  switch (origin.kind) {
    case "builtin":
    case "claude":
    case "codex":
    case "shared":
      return origin.kind;
    case "djl":
      return "shared";
    default:
      return "other";
  }
}

/**
 * Stable reorder by group so the list the keyboard walks matches the grouped list on
 * screen. Within a group the incoming (relevance or catalog) order is kept.
 */
export function orderSkillsByGroup<T>(
  skills: readonly T[],
  groupOf: (skill: T) => SkillGroupKey,
): T[] {
  return skills
    .map((skill, index) => ({ skill, index, rank: GROUP_ORDER.indexOf(groupOf(skill)) }))
    .toSorted((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.skill);
}

// Composer chips only know a skill's name. The `$` picker records which provider made each
// skill it lists so a chip can show the same logo the menu row showed.
const chipProviderByName = new Map<string, ProviderKind>();

export function rememberSkillChipProviders(
  skills: ReadonlyArray<Pick<ProviderSkillDescriptor, "name" | "scope" | "path" | "plugin">>,
): void {
  for (const skill of skills) {
    const { provider } = resolveSkillOrigin(skill);
    if (provider) chipProviderByName.set(skill.name.toLowerCase(), provider);
    else chipProviderByName.delete(skill.name.toLowerCase());
  }
}

export function skillChipProvider(name: string): ProviderKind | null {
  return chipProviderByName.get(name.toLowerCase()) ?? null;
}

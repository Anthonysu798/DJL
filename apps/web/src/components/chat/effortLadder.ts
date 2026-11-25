// FILE: effortLadder.ts
// Purpose: Puts a model's effort levels in slider order, weakest to strongest. Providers do not
//          agree on order: Gemini lists High before Low, and Cursor/OpenCode pass through
//          whatever their CLIs report, so the slider sorts known levels itself.

const NAMED_RANK: Record<string, number> = {
  none: 0,
  off: 0,
  minimal: 1,
  min: 1,
  low: 2,
  medium: 3,
  med: 3,
  high: 4,
  xhigh: 5,
  "extra-high": 5,
  extra_high: 5,
  max: 6,
  maximum: 6,
  ultra: 7,
  ultrathink: 8,
  ultracode: 9,
};

/**
 * Strength of one level, or null when unknown. Numeric levels are thinking-token budgets,
 * where -1 means "dynamic" (no fixed cap), the strongest.
 */
export function effortRank(id: string): number | null {
  const key = id.trim().toLowerCase();
  const named = NAMED_RANK[key];
  if (named !== undefined) return named;
  if (key !== "" && /^-?\d+$/.test(key)) {
    const budget = Number(key);
    return budget < 0 ? Number.POSITIVE_INFINITY : budget;
  }
  return null;
}

/**
 * Weakest to strongest. A ladder with any level the rank table does not know (a custom
 * OpenCode variant, say) keeps the provider's order, since its strength cannot be judged.
 */
export function orderEffortLevels<T extends { readonly id: string }>(levels: readonly T[]): T[] {
  const ranked = levels.map((level, index) => ({ level, index, rank: effortRank(level.id) }));
  if (ranked.some((entry) => entry.rank === null)) return [...levels];
  return ranked
    .toSorted((left, right) => left.rank! - right.rank! || left.index - right.index)
    .map((entry) => entry.level);
}

/** The parts of a model's trait selection the effort slider reads. */
export interface EffortTraits {
  readonly effortLevels: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly promptInjectedValues: readonly string[];
  readonly ultrathinkPromptControlled: boolean;
  readonly effort: string | null;
}

/**
 * The effort slider's stops, current value and strongest stop. Ultrathink is a word at the
 * start of the message, not a setting, so it is a stop only while the message carries it.
 * The strongest stop is Claude's Ultracode where it exists, otherwise the top of the ladder.
 */
export function resolveEffortSlider(traits: EffortTraits) {
  const levels = orderEffortLevels(
    traits.effortLevels
      .filter(
        (level) =>
          traits.ultrathinkPromptControlled || !traits.promptInjectedValues.includes(level.value),
      )
      .map((level) => ({ id: level.value, label: level.label })),
  );
  const value = traits.ultrathinkPromptControlled ? "ultrathink" : (traits.effort ?? "");
  const topLevel = levels.some((level) => level.id === "ultracode")
    ? "ultracode"
    : levels[levels.length - 1]?.id;
  return { levels, value, topLevel };
}

/** True when the strongest effort is chosen (the slider's purple stop). One-stop ladders never count. */
export function isTopEffortSelected(traits: EffortTraits): boolean {
  const { levels, value, topLevel } = resolveEffortSlider(traits);
  return levels.length > 1 && topLevel !== undefined && value === topLevel;
}

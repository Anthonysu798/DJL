// FILE: index.ts
// Purpose: The skills DJL ships for the new-chat topics. Picking a topic pins its skills to the
//          message; the server resolves the `djl-starter://<id>` path to the bundled folder
//          and inlines the SKILL.md for every provider.
// Layer: Shared package (browser-safe). Folders live in `../skills/<id>`; third-party ones are
//        pinned in `../sources.json` and refreshed with `bun scripts/vendor-starter-skills.ts`.

/** Virtual path prefix the web sends; the server maps it to the bundled skill folder. */
export const STARTER_SKILL_PATH_PREFIX = "djl-starter://";

export const STARTER_SKILL_IDS = [
  "docx",
  "copy-editing",
  "xlsx",
  "build-dashboard",
  "pptx",
  "theme-factory",
  "djl-research",
  "djl-email",
  "djl-planning",
  "frontend-design",
  "frontend-ui-engineering",
  "systematic-debugging",
  "djl-automation",
  "code-review-and-quality",
  "documentation-and-adrs",
  "create-readme",
] as const;

export type StarterSkillId = (typeof STARTER_SKILL_IDS)[number];

/** Skills each new-chat topic attaches, keyed by the topic ids in `HomeStarter.tsx`. */
export const HOME_TOPIC_SKILLS: Readonly<Record<string, readonly StarterSkillId[]>> = {
  documents: ["docx", "copy-editing"],
  data: ["xlsx", "build-dashboard"],
  slides: ["pptx", "theme-factory"],
  research: ["djl-research"],
  email: ["djl-email"],
  planning: ["djl-planning"],
  websites: ["frontend-design"],
  apps: ["frontend-design", "frontend-ui-engineering"],
  fixes: ["systematic-debugging"],
  automation: ["djl-automation"],
  review: ["code-review-and-quality"],
  docs: ["documentation-and-adrs", "create-readme"],
};

export function isStarterSkillId(value: string): value is StarterSkillId {
  return (STARTER_SKILL_IDS as readonly string[]).includes(value);
}

export function starterSkillPath(id: StarterSkillId): string {
  return `${STARTER_SKILL_PATH_PREFIX}${id}`;
}

/** The starter skill id in a `djl-starter://<id>` path, or null for any other path. */
export function starterSkillIdFromPath(path: string): StarterSkillId | null {
  if (!path.startsWith(STARTER_SKILL_PATH_PREFIX)) return null;
  const id = path.slice(STARTER_SKILL_PATH_PREFIX.length);
  return isStarterSkillId(id) ? id : null;
}

/**
 * Adds the pinned starter skills to the skills a message already references, as
 * `{ name, path }` references the server resolves, skipping any already present.
 */
export function withStarterSkills<T extends { readonly name: string; readonly path: string }>(
  skills: readonly T[],
  starter: readonly StarterSkillId[],
): Array<T | { name: StarterSkillId; path: string }> {
  const merged: Array<T | { name: StarterSkillId; path: string }> = [...skills];
  for (const id of starter) {
    const path = starterSkillPath(id);
    if (!merged.some((skill) => skill.path === path || skill.name === id)) {
      merged.push({ name: id, path });
    }
  }
  return merged;
}

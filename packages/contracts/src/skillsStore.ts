// FILE: skillsStore.ts
// Purpose: Schema-only contracts for the Skills store on the Plugins page: the curated catalog
//          (bundled, refreshed online), live skills.sh search, and DJL-installed skills in
//          `~/.djl/skills`.

import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const SKILLS_STORE_CATEGORIES = [
  "design",
  "coding",
  "documents",
  "writing",
  "research",
  "data",
  "tools",
] as const;
export const SkillsStoreCategory = Schema.Literals(SKILLS_STORE_CATEGORIES);
export type SkillsStoreCategory = typeof SkillsStoreCategory.Type;

/** A summary per UI locale; English is required and used as the fallback. */
export const SkillsStoreSummary = Schema.Struct({
  en: TrimmedNonEmptyString,
  "zh-Hans": Schema.optional(TrimmedNonEmptyString),
  "zh-Hant": Schema.optional(TrimmedNonEmptyString),
  ja: Schema.optional(TrimmedNonEmptyString),
  ko: Schema.optional(TrimmedNonEmptyString),
  fr: Schema.optional(TrimmedNonEmptyString),
  "es-419": Schema.optional(TrimmedNonEmptyString),
});
export type SkillsStoreSummary = typeof SkillsStoreSummary.Type;

/** One reviewed skill, pinned to a commit and the hash of its folder. */
export const SkillsStoreCatalogEntry = Schema.Struct({
  /** `owner/repo/skill`, the same id skills.sh uses. */
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  commit: TrimmedNonEmptyString,
  sha256: TrimmedNonEmptyString,
  license: TrimmedNonEmptyString,
  category: SkillsStoreCategory,
  summary: SkillsStoreSummary,
  hasScripts: Schema.Boolean,
  installs: Schema.optional(Schema.Number),
  /** Ships with DJL as a starter skill, so there is nothing to install. */
  builtIn: Schema.optional(Schema.Boolean),
});
export type SkillsStoreCatalogEntry = typeof SkillsStoreCatalogEntry.Type;

export const SkillsStoreCatalogFile = Schema.Struct({
  version: Schema.Number,
  entries: Schema.Array(SkillsStoreCatalogEntry),
});
export type SkillsStoreCatalogFile = typeof SkillsStoreCatalogFile.Type;

export const SkillsStoreInstalledSkill = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  commit: TrimmedNonEmptyString,
  license: TrimmedNonEmptyString,
  source: Schema.Literals(["curated", "search"]),
  installedAt: TrimmedNonEmptyString,
  /** The folder no longer matches what DJL installed: the user edited it. */
  edited: Schema.Boolean,
  /** A newer reviewed version is in the catalog. */
  updateAvailable: Schema.Boolean,
});
export type SkillsStoreInstalledSkill = typeof SkillsStoreInstalledSkill.Type;

export const SkillsStoreSnapshot = Schema.Struct({
  catalog: Schema.Array(SkillsStoreCatalogEntry),
  installed: Schema.Array(SkillsStoreInstalledSkill),
});
export type SkillsStoreSnapshot = typeof SkillsStoreSnapshot.Type;

export const SkillsStoreSearchInput = Schema.Struct({ query: TrimmedNonEmptyString });
export type SkillsStoreSearchInput = typeof SkillsStoreSearchInput.Type;

/** A live skills.sh result. Not reviewed by DJL. */
export const SkillsStoreSearchResult = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  installs: Schema.Number,
  /** Only GitHub-hosted skills can be installed. */
  installable: Schema.Boolean,
});
export type SkillsStoreSearchResult = typeof SkillsStoreSearchResult.Type;

export const SkillsStoreSearchResultList = Schema.Struct({
  results: Schema.Array(SkillsStoreSearchResult),
});
export type SkillsStoreSearchResultList = typeof SkillsStoreSearchResultList.Type;

export const SkillsStoreSkillInput = Schema.Struct({
  /** `owner/repo/skill`. */
  id: TrimmedNonEmptyString,
  /** The user agreed to install a skill that includes scripts. */
  allowScripts: Schema.optional(Schema.Boolean),
  /** The user agreed to replace their own edits to the installed folder. */
  overwriteEdits: Schema.optional(Schema.Boolean),
});
export type SkillsStoreSkillInput = typeof SkillsStoreSkillInput.Type;

export const SkillsStorePreviewInput = Schema.Struct({ id: TrimmedNonEmptyString });
export type SkillsStorePreviewInput = typeof SkillsStorePreviewInput.Type;

export const SkillsStorePreview = Schema.Struct({ markdown: Schema.String });
export type SkillsStorePreview = typeof SkillsStorePreview.Type;

/**
 * Install / update outcome. A skill that runs scripts, or an update over the user's own edits,
 * comes back as `needsConsent` so the UI can ask, then retry with the matching flag.
 */
export const SkillsStoreChangeResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("done"), snapshot: SkillsStoreSnapshot }),
  Schema.Struct({
    status: Schema.Literal("needsConsent"),
    reason: Schema.Literals(["scripts", "edits"]),
    /** For "scripts": the script files the skill includes. */
    files: Schema.Array(Schema.String),
  }),
]);
export type SkillsStoreChangeResult = typeof SkillsStoreChangeResult.Type;

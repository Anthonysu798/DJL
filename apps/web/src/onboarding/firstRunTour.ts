import { Schema } from "effect";

export const FIRST_RUN_TOUR_VERSION = 1;
export const FIRST_RUN_TOUR_STORAGE_KEY = "synara:first-run-tour:v1";
export const FIRST_RUN_TOUR_REPLAY_EVENT = "synara:first-run-tour:replay";
export const SETTINGS_TOUR_VERSION = 1;
export const SETTINGS_TOUR_STORAGE_KEY = "synara:settings-tour:v1";
export const SETTINGS_TOUR_REPLAY_EVENT = "synara:settings-tour:replay";
export const MODEL_GUIDE_VERSION = 1;
export const MODEL_GUIDE_STORAGE_KEY = "synara:model-guide:v1";
export const MODEL_GUIDE_REPLAY_EVENT = "synara:model-guide:replay";
export const MODEL_PICKER_OPEN_EVENT = "synara:model-picker:open";

export const FirstRunTourStorageSchema = Schema.Struct({
  seenVersion: Schema.Number,
});

export type FirstRunTourStorage = typeof FirstRunTourStorageSchema.Type;

export const SettingsTourStorageSchema = Schema.Struct({
  seenVersion: Schema.Number,
});

export type SettingsTourStorage = typeof SettingsTourStorageSchema.Type;

export const ModelGuideStorageSchema = Schema.Struct({
  seenVersion: Schema.Number,
});

export type ModelGuideStorage = typeof ModelGuideStorageSchema.Type;

export const INITIAL_FIRST_RUN_TOUR_STORAGE: FirstRunTourStorage = {
  seenVersion: 0,
};

export const INITIAL_SETTINGS_TOUR_STORAGE: SettingsTourStorage = {
  seenVersion: 0,
};

export const INITIAL_MODEL_GUIDE_STORAGE: ModelGuideStorage = {
  seenVersion: 0,
};

export const FIRST_RUN_LOCAL_AI_TARGETS = [
  "local-ai-purpose",
  "local-ai-device",
  "local-ai-prepare",
] as const;

export const FIRST_RUN_TUTORIAL_REPLAY_TARGET = "tutorial-replay";
export const MODEL_GUIDE_TARGET = "model-guide";

export const FIRST_RUN_CORE_TOUR_TARGETS = [
  "work-mode",
  "project-mode",
  "settings",
  FIRST_RUN_TUTORIAL_REPLAY_TARGET,
] as const;

export const FIRST_RUN_TOUR_TARGETS = [
  FIRST_RUN_CORE_TOUR_TARGETS[0],
  FIRST_RUN_CORE_TOUR_TARGETS[1],
  ...FIRST_RUN_LOCAL_AI_TARGETS,
  FIRST_RUN_CORE_TOUR_TARGETS[2],
  FIRST_RUN_CORE_TOUR_TARGETS[3],
] as const;

export type FirstRunTourTarget = (typeof FIRST_RUN_TOUR_TARGETS)[number];

export function resolveFirstRunTourTargets(input: {
  readonly includeLocalAiSteps: boolean;
  readonly includeModelGuide: boolean;
}): ReadonlyArray<FirstRunTourTarget | typeof MODEL_GUIDE_TARGET> {
  const baseTargets = input.includeLocalAiSteps
    ? FIRST_RUN_TOUR_TARGETS
    : FIRST_RUN_CORE_TOUR_TARGETS;
  return input.includeModelGuide ? [...baseTargets, MODEL_GUIDE_TARGET] : baseTargets;
}

export function isFirstRunLocalAiTarget(target: string): boolean {
  return (FIRST_RUN_LOCAL_AI_TARGETS as readonly string[]).includes(target);
}

export function settingsTourTarget(sectionId: string): string {
  return `settings-section-${sectionId}`;
}

export function shouldAutoStartFirstRunTour(input: {
  readonly threadsHydrated: boolean;
  readonly seenVersion: number;
}): boolean {
  return input.threadsHydrated && input.seenVersion < FIRST_RUN_TOUR_VERSION;
}

export function markFirstRunTourSeen(storage: FirstRunTourStorage): FirstRunTourStorage {
  return {
    seenVersion: Math.max(storage.seenVersion, FIRST_RUN_TOUR_VERSION),
  };
}

export function shouldAutoStartSettingsTour(input: {
  readonly firstRunSeenVersion: number;
  readonly pathname: string;
  readonly seenVersion: number;
  readonly threadsHydrated: boolean;
}): boolean {
  return (
    input.threadsHydrated &&
    input.pathname === "/settings" &&
    input.firstRunSeenVersion >= FIRST_RUN_TOUR_VERSION &&
    input.seenVersion < SETTINGS_TOUR_VERSION
  );
}

export function markSettingsTourSeen(storage: SettingsTourStorage): SettingsTourStorage {
  return {
    seenVersion: Math.max(storage.seenVersion, SETTINGS_TOUR_VERSION),
  };
}

export function shouldAutoStartModelGuide(input: {
  readonly firstRunSeenVersion: number;
  readonly seenVersion: number;
  readonly threadsHydrated: boolean;
}): boolean {
  return (
    input.threadsHydrated &&
    input.firstRunSeenVersion >= FIRST_RUN_TOUR_VERSION &&
    input.seenVersion < MODEL_GUIDE_VERSION
  );
}

export function markModelGuideSeen(storage: ModelGuideStorage): ModelGuideStorage {
  return {
    seenVersion: Math.max(storage.seenVersion, MODEL_GUIDE_VERSION),
  };
}

export function requestFirstRunTourReplay(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FIRST_RUN_TOUR_REPLAY_EVENT));
}

export function requestSettingsTourReplay(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SETTINGS_TOUR_REPLAY_EVENT));
}

export function requestModelGuideReplay(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MODEL_GUIDE_REPLAY_EVENT));
}

export function requestModelPickerOpen(target?: HTMLElement | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(MODEL_PICKER_OPEN_EVENT, {
      detail: { target: target ?? null },
    }),
  );
}

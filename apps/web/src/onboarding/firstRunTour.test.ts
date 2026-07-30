import { describe, expect, it } from "vitest";

import {
  FIRST_RUN_TOUR_VERSION,
  FIRST_RUN_CORE_TOUR_TARGETS,
  FIRST_RUN_LOCAL_AI_TARGETS,
  FIRST_RUN_TOUR_TARGETS,
  FIRST_RUN_TUTORIAL_REPLAY_TARGET,
  SETTINGS_TOUR_VERSION,
  markFirstRunTourSeen,
  markSettingsTourSeen,
  shouldAutoStartFirstRunTour,
  shouldAutoStartSettingsTour,
} from "./firstRunTour";

describe("first-run tour state", () => {
  it("includes the local AI champion walkthrough before Settings", () => {
    expect(FIRST_RUN_LOCAL_AI_TARGETS).toEqual([
      "local-ai-purpose",
      "local-ai-device",
      "local-ai-prepare",
    ]);
    expect(FIRST_RUN_TOUR_TARGETS).toEqual([
      FIRST_RUN_CORE_TOUR_TARGETS[0],
      FIRST_RUN_CORE_TOUR_TARGETS[1],
      ...FIRST_RUN_LOCAL_AI_TARGETS,
      FIRST_RUN_CORE_TOUR_TARGETS[2],
      FIRST_RUN_CORE_TOUR_TARGETS[3],
    ]);
    expect(FIRST_RUN_CORE_TOUR_TARGETS).toEqual([
      "work-mode",
      "project-mode",
      "settings",
      FIRST_RUN_TUTORIAL_REPLAY_TARGET,
    ]);
  });

  it("waits for thread hydration before opening an unseen tour", () => {
    expect(
      shouldAutoStartFirstRunTour({
        threadsHydrated: false,
        seenVersion: 0,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartFirstRunTour({
        threadsHydrated: true,
        seenVersion: 0,
      }),
    ).toBe(true);
  });

  it("does not reopen a completed tour at the current version", () => {
    expect(
      shouldAutoStartFirstRunTour({
        threadsHydrated: true,
        seenVersion: FIRST_RUN_TOUR_VERSION,
      }),
    ).toBe(false);
  });

  it("marks completion without moving a newer stored version backwards", () => {
    expect(markFirstRunTourSeen({ seenVersion: 0 })).toEqual({
      seenVersion: FIRST_RUN_TOUR_VERSION,
    });
    expect(markFirstRunTourSeen({ seenVersion: FIRST_RUN_TOUR_VERSION + 1 })).toEqual({
      seenVersion: FIRST_RUN_TOUR_VERSION + 1,
    });
  });
});

describe("settings tour state", () => {
  it("starts only after the basic tour is seen and Settings is open", () => {
    expect(
      shouldAutoStartSettingsTour({
        firstRunSeenVersion: 0,
        pathname: "/settings",
        seenVersion: 0,
        threadsHydrated: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartSettingsTour({
        firstRunSeenVersion: FIRST_RUN_TOUR_VERSION,
        pathname: "/",
        seenVersion: 0,
        threadsHydrated: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartSettingsTour({
        firstRunSeenVersion: FIRST_RUN_TOUR_VERSION,
        pathname: "/settings",
        seenVersion: 0,
        threadsHydrated: true,
      }),
    ).toBe(true);
  });

  it("does not reopen after it has been seen", () => {
    expect(
      shouldAutoStartSettingsTour({
        firstRunSeenVersion: FIRST_RUN_TOUR_VERSION,
        pathname: "/settings",
        seenVersion: SETTINGS_TOUR_VERSION,
        threadsHydrated: true,
      }),
    ).toBe(false);
  });

  it("marks settings completion without moving a newer version backwards", () => {
    expect(markSettingsTourSeen({ seenVersion: 0 })).toEqual({
      seenVersion: SETTINGS_TOUR_VERSION,
    });
    expect(markSettingsTourSeen({ seenVersion: SETTINGS_TOUR_VERSION + 1 })).toEqual({
      seenVersion: SETTINGS_TOUR_VERSION + 1,
    });
  });
});

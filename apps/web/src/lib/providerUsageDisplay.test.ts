import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import englishCatalog from "../i18n/locales/en.json";
import frenchCatalog from "../i18n/locales/fr.json";

import {
  deriveProviderUsageDisplayRows,
  providerUsagePaceDetails,
  providerUsageProgressTrackProps,
  selectPrimaryProviderUsageDisplayRow,
} from "./providerUsageDisplay";

describe("providerUsageDisplay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects the most constrained display row for compact header chips", () => {
    const rows = deriveProviderUsageDisplayRows([
      {
        provider: "claudeAgent",
        updatedAt: "2099-04-08T18:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 7,
            resetsAt: "2099-04-08T20:00:00.000Z",
            windowDurationMins: 300,
          },
          {
            window: "Weekly",
            usedPercent: 84,
            resetsAt: "2099-04-14T18:00:00.000Z",
            windowDurationMins: 10080,
          },
        ],
      },
    ]);

    const primary = selectPrimaryProviderUsageDisplayRow(rows);

    expect(primary?.label).toBe("Weekly");
    expect(primary?.remainingLabel).toBe("16%");
    expect(primary?.remainingTone).toBe("warning");
  });

  it("centralizes reserve and eta details for display rows", () => {
    vi.setSystemTime("2026-06-09T12:00:00.000Z");

    const [row] = deriveProviderUsageDisplayRows([
      {
        provider: "codex",
        updatedAt: "2026-06-09T12:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 15,
            resetsAt: "2026-06-09T12:36:00.000Z",
            windowDurationMins: 300,
          },
        ],
      },
    ]);

    expect(row ? providerUsagePaceDetails(row) : null).toEqual({
      amountText: "73% in reserve",
      etaText: "Lasts until reset",
    });
  });

  it("infers standard window durations from normalized labels for pace details", () => {
    vi.setSystemTime("2026-06-09T12:00:00.000Z");

    const [row] = deriveProviderUsageDisplayRows([
      {
        provider: "codex",
        updatedAt: "2026-06-09T12:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 9,
            resetsAt: "2026-06-09T15:00:00.000Z",
          },
        ],
      },
    ]);

    expect(row?.markerPercent).toBe(60);
    expect(row ? providerUsagePaceDetails(row) : null).toEqual({
      amountText: "31% in reserve",
      etaText: "Lasts until reset",
    });
  });

  it("localizes shared labels, remaining copy, reset countdowns, pace, and accessibility text", async () => {
    vi.setSystemTime("2026-06-09T12:00:00.000Z");
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({
      fallbackLng: "en",
      lng: "fr",
      resources: { en: englishCatalog, fr: frenchCatalog },
    });

    const [row] = deriveProviderUsageDisplayRows(
      [
        {
          provider: "codex",
          updatedAt: "2026-06-09T12:00:00.000Z",
          limits: [
            {
              window: "Weekly",
              usedPercent: 84,
              resetsAt: "2026-06-15T14:16:00.000Z",
              windowDurationMins: 10_080,
            },
          ],
        },
      ],
      { t: i18n.t, locale: "fr" },
    );

    expect(row).toMatchObject({
      id: "codex-Weekly",
      label: "Hebdomadaire",
      remainingLabel: "16 %",
      leftText: "16 % restants",
      resetText: "Réinitialisation dans 6 j 2 h",
    });
    expect(row ? providerUsagePaceDetails(row) : null).toEqual({
      amountText: "71 % de déficit",
      etaText: "Épuisement dans 4 h 8 min",
    });
    expect(row ? providerUsageProgressTrackProps(row, i18n.t) : null).toMatchObject({
      label: "Hebdomadaire : 16 % restants",
    });
  });
});

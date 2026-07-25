import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";

describe("SettingsLoadError", () => {
  it("keeps an Error message exact alongside localized summary and action copy", () => {
    const markup = renderToStaticMarkup(
      <SettingsLoadError
        summary="Impossible de charger les modèles locaux."
        detail={settingsLoadErrorDetail(new Error("raw runtime: ECONNRESET"), "Secours localisé")}
        actionLabel="Réessayer"
        onAction={() => {}}
      />,
    );

    expect(markup).toContain("Impossible de charger les modèles locaux.");
    expect(markup).toContain("raw runtime: ECONNRESET");
    expect(markup).toContain("Réessayer");
  });

  it("uses the localized fallback for non-Error failures", () => {
    expect(settingsLoadErrorDetail({ reason: "opaque" }, "Détail de secours localisé")).toBe(
      "Détail de secours localisé",
    );
  });
});

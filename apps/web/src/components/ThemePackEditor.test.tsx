import { describe, expect, it } from "vitest";
import { initializeI18nInstance } from "../i18n";
import { getThemePackEditorCopy } from "./ThemePackEditor";

describe("ThemePackEditor localization", () => {
  it("resolves visible copy and generated accessibility labels in the active locale", async () => {
    const { instance } = await initializeI18nInstance({ preference: "fr", documentElement: null });
    const t = instance.getFixedT("fr", "settings");
    const copy = getThemePackEditorCopy(t, {
      variant: "dark",
      isActive: true,
      mode: "dark",
    });

    expect(copy.title).toBe("Thème sombre");
    expect(copy.status).toBe("C’est le thème actif.");
    expect(copy.actions).toMatchObject({
      reset: "Réinitialiser",
      import: "Importer",
      copy: "Copier",
    });
    expect(copy.rows.accent).toBe("Accentuation");
    expect(copy.aria.accentColor).toBe("Couleur d’accentuation du thème sombre");
    expect(copy.dialog.title).toBe("Importer le thème sombre");
    expect(copy.dialog.shareStringAriaLabel).toBe("Chaîne de partage du thème");
  });
});

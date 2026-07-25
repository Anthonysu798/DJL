// Browser component tests render isolated fragments rather than the app entrypoint,
// so install the same English i18n instance that main.tsx initializes in production.
import { initializeI18nInstance, rendererI18n } from "../i18n";

await initializeI18nInstance({
  documentElement: document.documentElement,
  instance: rendererI18n,
  languages: ["en"],
  preference: "en",
  production: false,
});

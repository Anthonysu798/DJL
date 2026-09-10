import reviewStatus from "../../../../packages/shared/src/localeReviewStatus.json";
import { StartupStorage, startupSurfaceForPath } from "./storage";
import { StartupSession, setStartupSession } from "./session";
import { mountStartupShell } from "./shell";

function normalizeLocale(value: string): string {
  try {
    const locale = new Intl.Locale(value.replaceAll("_", "-"));
    if (locale.language === "zh")
      return locale.script === "Hant" || ["TW", "HK", "MO"].includes(locale.region ?? "")
        ? "zh-Hant"
        : "zh-Hans";
    if (locale.language === "es") return "es-419";
    return ["en", "ja", "ko", "fr"].includes(locale.language) ? locale.language : "en";
  } catch {
    return "en";
  }
}

function startupLocale(fallback?: string): string {
  let preference: string | undefined;
  try {
    const raw = localStorage.getItem("synara:app-settings:v1");
    if (raw && raw.length < 256_000) preference = JSON.parse(raw)?.language;
  } catch {
    /* A damaged preference must not prevent startup. */
  }
  const supported = (candidate: string) =>
    !import.meta.env.PROD || reviewStatus[candidate as keyof typeof reviewStatus] === "approved";
  if (preference && preference !== "system" && supported(preference))
    return normalizeLocale(preference);
  let system = navigator.language;
  try {
    system = window.desktopBridge?.locale.getPreferredSystemLanguages()[0] ?? system;
  } catch {
    /* Use the browser locale if preload is unavailable. */
  }
  const locale = normalizeLocale(system || fallback || "en");
  return supported(locale) ? locale : "en";
}

export function startLocalInterface(): StartupSession | null {
  let scope: string | undefined;
  try {
    scope = window.desktopBridge?.getStartupScope?.();
  } catch {
    return null;
  }
  if (!scope || !/^[a-f0-9]{24}$/.test(scope)) return null;
  const storage = new StartupStorage(scope);
  const snapshot = storage.readSnapshot();
  const initialPath = (location.hash.slice(1).split("?")[0] || "/").replace(/\/$/, "") || "/";
  const session = new StartupSession(
    storage,
    startupSurfaceForPath(storage, initialPath),
    snapshot,
  );
  if (!["/", "/work", "/studio"].includes(initialPath)) session.navigate(initialPath);
  setStartupSession(session);
  const root = document.getElementById("root");
  if (root) root.inert = true;
  const locale = startupLocale(snapshot?.locale);
  const mount = () =>
    session.attachShell(
      mountStartupShell({
        draft: session.draft,
        snapshot,
        locale,
        editable: session.navigationTarget === null,
        onEdit: (text) => session.edit(text),
        onSend: () => {
          session.requestSend();
        },
        onCancelSend: () => session.cancelSend(),
        onNavigate: (target) => {
          session.navigate(target);
          location.hash = `#${target}`;
          mount();
        },
        onRetry: () => location.reload(),
      }),
    );
  mount();
  performance.mark("djl.startup.local-input-ready");
  requestAnimationFrame(() => requestAnimationFrame(() => window.desktopBridge?.notifyReady?.()));
  return session;
}

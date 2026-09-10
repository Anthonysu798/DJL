import type { StartupDraft, StartupModel, StartupSnapshot, StartupSurface } from "./types";

export const MAX_STARTUP_TEXT_LENGTH = 65_536;
const MAX_DRAFT_JSON_LENGTH = 512 * 1024;
const MAX_SNAPSHOT_JSON_LENGTH = 48 * 1024;
type StorageIO = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function browserStorage(): StorageIO | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeStartupModel(value: unknown): StartupModel | null {
  if (
    !record(value) ||
    !identifier(value.provider) ||
    typeof value.model !== "string" ||
    !value.model ||
    value.model.length > 512
  )
    return null;
  return { provider: value.provider, model: value.model };
}

export function createStartupDraft(
  surface: StartupSurface,
  model: StartupModel | null,
): StartupDraft {
  return {
    id: crypto.randomUUID(),
    surface,
    text: "",
    threadId: null,
    model: normalizeStartupModel(model),
    sendState: "editing",
    revision: 0,
    updatedAt: Date.now(),
  };
}

function normalizeDraft(value: unknown, surface: StartupSurface): StartupDraft | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    !identifier(value.id) ||
    value.surface !== surface ||
    typeof value.text !== "string" ||
    value.text.length > MAX_STARTUP_TEXT_LENGTH ||
    (value.threadId !== null && !identifier(value.threadId)) ||
    !["editing", "pending", "claimed", "uncertain"].includes(String(value.sendState)) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt)
  )
    return null;
  return {
    id: value.id,
    surface,
    text: value.text,
    threadId: value.threadId as string | null,
    model: normalizeStartupModel(value.model),
    sendState: value.sendState as StartupDraft["sendState"],
    revision: value.revision,
    updatedAt: value.updatedAt,
  };
}

export function normalizeStartupSnapshot(value: unknown): StartupSnapshot | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.savedAt !== "number" ||
    !Number.isFinite(value.savedAt)
  )
    return null;
  const rows = (input: unknown, limit: number) =>
    Array.isArray(input)
      ? input
          .slice(0, limit)
          .flatMap((row) =>
            record(row) && identifier(row.id) && typeof row.title === "string"
              ? [{ id: row.id, title: row.title.slice(0, 180) }]
              : [],
          )
      : [];
  return {
    version: 1,
    savedAt: value.savedAt,
    locale: typeof value.locale === "string" && value.locale.length <= 20 ? value.locale : "en",
    theme: value.theme === "dark" ? "dark" : "light",
    sidebarWidth:
      typeof value.sidebarWidth === "number" && Number.isFinite(value.sidebarWidth)
        ? Math.max(208, Math.min(400, value.sidebarWidth))
        : 260,
    projects: rows(value.projects, 32),
    threads: rows(value.threads, 40),
    model: normalizeStartupModel(value.model),
  };
}

export class StartupStorage {
  constructor(
    private readonly scope: string,
    private readonly storage: StorageIO | null = browserStorage(),
  ) {}

  private key(name: string): string {
    return `synara:startup:v1:${encodeURIComponent(this.scope)}:${name}`;
  }
  private read(name: string, limit: number): unknown {
    try {
      const raw = this.storage?.getItem(this.key(name));
      return raw && raw.length <= limit ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  readDraft(surface: StartupSurface): StartupDraft | null {
    return normalizeDraft(this.read(`draft:${surface}`, MAX_DRAFT_JSON_LENGTH), surface);
  }
  writeDraft(draft: StartupDraft): boolean {
    try {
      const normalized = normalizeDraft({ version: 1, ...draft }, draft.surface);
      if (!this.storage || !normalized) return false;
      this.storage.setItem(
        this.key(`draft:${draft.surface}`),
        JSON.stringify({ version: 1, ...normalized }),
      );
      return true;
    } catch {
      return false;
    }
  }
  removeDraft(surface: StartupSurface, id: string): void {
    try {
      if (this.readDraft(surface)?.id === id)
        this.storage?.removeItem(this.key(`draft:${surface}`));
    } catch {
      /* Preserve the recoverable record if storage is unavailable. */
    }
  }
  readSnapshot(): StartupSnapshot | null {
    const snapshot = normalizeStartupSnapshot(this.read("snapshot", MAX_SNAPSHOT_JSON_LENGTH));
    return snapshot && Date.now() - snapshot.savedAt < 7 * 24 * 60 * 60 * 1000 ? snapshot : null;
  }
  writeSnapshot(snapshot: StartupSnapshot): void {
    try {
      const normalized = normalizeStartupSnapshot(snapshot);
      if (normalized) this.storage?.setItem(this.key("snapshot"), JSON.stringify(normalized));
    } catch {
      /* Snapshot persistence must never interrupt editing. */
    }
  }
}

/** Select the correct local draft for a direct reload, including Work thread URLs. */
export function startupSurfaceForPath(storage: StartupStorage, path: string): StartupSurface {
  if (["/work", "/studio"].includes(path)) return "work";
  const work = storage.readDraft("work");
  return work?.text && `/${work.threadId ?? work.id}` === path ? "work" : "home";
}

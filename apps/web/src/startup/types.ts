export type StartupSurface = "home" | "work";
export interface StartupModel {
  provider: string;
  model: string;
}
export interface StartupDraft {
  id: string;
  surface: StartupSurface;
  text: string;
  threadId: string | null;
  model: StartupModel | null;
  sendState: "editing" | "pending" | "claimed" | "uncertain";
  revision: number;
  updatedAt: number;
}
export interface StartupSnapshot {
  version: 1;
  savedAt: number;
  locale: string;
  theme: "light" | "dark";
  sidebarWidth: number;
  projects: Array<{ id: string; title: string }>;
  threads: Array<{ id: string; title: string }>;
  model: StartupModel | null;
}
export type StartupStatus = "loading" | "storage-error" | "runtime-error";
export interface StartupShellOptions {
  draft: StartupDraft;
  snapshot: StartupSnapshot | null;
  locale: string;
  editable: boolean;
  onEdit: (text: string) => void;
  onSend: () => void;
  onCancelSend: () => void;
  onNavigate: (path: string) => void;
  onRetry: () => void;
}
export interface StartupShellHandle {
  update: (draft: StartupDraft, status?: StartupStatus) => void;
  selection: () => { start: number; end: number };
  isFocused: () => boolean;
  isComposing: () => boolean;
  destroy: () => void;
}

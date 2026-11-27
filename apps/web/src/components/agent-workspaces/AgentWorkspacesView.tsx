import { ensureNativeApi } from "~/nativeApi";
import { ProfileSignInDialog } from "./ProfileSignInDialog";
import { WorkspaceAccountRow, RefreshWorkspaceAccounts } from "./WorkspaceAccountRow";
import { getWorkspaceViewState, removeWorkspaceViewState } from "./workspaceViewState";
import { workspaceTerminalSessions } from "./workspaceTerminalSessions";
import {
  observeWorkspaceTerminalVisibility,
  isWorkspaceTerminalVisible,
} from "./workspaceTerminalVisibility";
import { NewTerminalDialog } from "./NewTerminalDialog";
import { useWorkspaceAccounts, type WorkspaceAccount } from "./workspaceAccounts";
import { TerminalCloseDialog } from "./TerminalCloseDialog";
import "@xterm/xterm/css/xterm.css";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { CLI_ACCOUNTS_QUERY_KEY } from "~/lib/cliAccountsQuery";
import { resolveWorkspaceProfile, terminalProfileId } from "~/lib/workspaceAccountIds";
import { ProviderIcon } from "~/components/ProviderIcon";
import {
  type AgentAccountProfile,
  type AgentWorkspace,
  type AgentWorkspacePane,
  useAgentWorkspaceStore,
} from "~/agentWorkspaceStore";
import { useStore } from "~/store";
import { cn } from "~/lib/utils";
import {
  FolderIcon,
  FolderOpenIcon,
  Maximize2,
  Minimize2,
  PlusIcon,
  TerminalIcon,
  XIcon,
} from "~/lib/icons";
import { Button } from "~/components/ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "~/components/ui/select";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import {
  terminalRuntimeRegistry,
  buildTerminalRuntimeKey,
} from "~/components/terminal/terminalRuntimeRegistry";
import type { TerminalRuntimeStatus } from "~/components/terminal/terminalRuntimeTypes";
import "./agentWorkspaces.css";

const PROVIDERS = {
  codex: "Codex",
  claudeAgent: "Claude Code",
  cursor: "Cursor",
  opencode: "OpenCode",
} as const;
const BROWSE_FOLDER = "__browse-folder__";
const folderName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? path;

export const TerminalPane = memo(function TerminalPane({
  workspace,
  pane,
  profile,
  maximized,
  workspaceVisible = true,
  onMaximize,
  onClose,
  onDuplicate,
}: {
  workspace: AgentWorkspace;
  pane: AgentWorkspacePane;
  profile: AgentAccountProfile | undefined;
  maximized: boolean;
  workspaceVisible?: boolean;
  onMaximize: (id: string) => void;
  onClose: (workspace: AgentWorkspace, pane: AgentWorkspacePane) => void;
  onDuplicate: (workspaceId: string, pane: AgentWorkspacePane) => void;
}) {
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  const container = useRef<HTMLDivElement>(null);
  const viewportVisible = useRef(false);
  const workspaceVisibility = useRef(workspaceVisible);
  workspaceVisibility.current = workspaceVisible;
  const runtimeKey = buildTerminalRuntimeKey(workspace.id, pane.id);
  const retainedSession = workspaceTerminalSessions.get(workspace.id, pane.id);
  const [status, setStatus] = useState<TerminalRuntimeStatus>(
    () => retainedSession?.state.status ?? "connecting",
  );
  const [exited, setExited] = useState(() => retainedSession?.state.exited ?? false);
  const [busy, setBusy] = useState(() => retainedSession?.state.busy ?? false);
  const [rendered, setRendered] = useState(() => Boolean(terminalRuntimeRegistry.peek(runtimeKey)));
  const profileId = profile?.id;
  const provider = profile?.provider;
  const label = provider ? PROVIDERS[provider] : t("shell");
  useLayoutEffect(() => {
    const host = container.current;
    if (!host) return;
    const agentProfile =
      profileId && provider
        ? { provider, profileId: terminalProfileId(profileId), action: pane.action }
        : undefined;
    const session = workspaceTerminalSessions.ensure({
      threadId: workspace.id,
      terminalId: pane.id,
      cwd: workspace.cwd,
      ...(agentProfile ? { agentProfile } : {}),
    });
    let visible = false;
    let generation = 0;
    let disposed = false;
    let initialized = false;
    const unsubscribeState = workspaceTerminalSessions.subscribe(session, (state) => {
      setStatus(state.status);
      setExited(state.exited);
      setBusy(state.busy);
    });
    const attach = (isVisible: boolean) => {
      terminalRuntimeRegistry.attach(
        {
          runtimeKey,
          threadId: workspace.id,
          terminalId: pane.id,
          cwd: workspace.cwd,
          terminalLabel: label,
          imageSupport: false,
          lightweight: true,
          screenSnapshot: true,
          serverHandlesQueries: session.headlessQueries,
          ...(agentProfile ? { agentProfile } : {}),
          callbacks: workspaceTerminalSessions.retainRenderer(session, () =>
            terminalRuntimeRegistry.dispose(runtimeKey),
          ),
        },
        {
          autoFocus: isVisible && getWorkspaceViewState(workspace.id).focusedPane === pane.id,
          isVisible,
        },
        host,
      );
      initialized = true;
      setRendered(true);
    };
    // A warm screen is already parsed. Move it back before paint without waiting
    // for IntersectionObserver, a process-open request, or history replay.
    if (terminalRuntimeRegistry.peek(runtimeKey)) {
      visible = workspaceVisibility.current && isWorkspaceTerminalVisible(host);
      viewportVisible.current = visible;
      attach(visible);
    }
    const unsubscribeVisibility = observeWorkspaceTerminalVisibility(host, (nextVisible) => {
      if (workspaceVisibility.current && document.visibilityState !== "hidden") {
        viewportVisible.current = nextVisible;
      }
      nextVisible = nextVisible && workspaceVisibility.current;
      if (visible === nextVisible || disposed) return;
      visible = nextVisible;
      const request = ++generation;
      if (initialized) {
        terminalRuntimeRegistry.setViewState(runtimeKey, { autoFocus: false, isVisible: visible });
        return;
      }
      if (!visible) return;
      workspaceTerminalSessions.prioritize(session);
      void session.ready.then(() => {
        if (disposed || !visible || generation !== request || session.cancelled) return;
        attach(true);
      });
    });
    return () => {
      disposed = true;
      generation++;
      unsubscribeVisibility();
      unsubscribeState();
      terminalRuntimeRegistry.detach(runtimeKey);
    };
  }, [runtimeKey, workspace.id, workspace.cwd, pane.id, pane.action, profileId, provider, label]);
  useLayoutEffect(() => {
    if (!container.current || !terminalRuntimeRegistry.peek(runtimeKey)) return;
    terminalRuntimeRegistry.setViewState(runtimeKey, {
      autoFocus: false,
      // Visibility is already known from this canvas's last visit. Reading every
      // pane's geometry here forces repeated layout of real CLI screens.
      isVisible: workspaceVisible && viewportVisible.current,
    });
  }, [runtimeKey, workspaceVisible]);
  return (
    <section
      onFocusCapture={() => {
        getWorkspaceViewState(workspace.id).focusedPane = pane.id;
      }}
      className="agent-terminal-pane"
      aria-label={`${label} · ${profile?.name ?? t("shell")}`}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            exited
              ? "bg-muted-foreground"
              : status === "error"
                ? "bg-destructive"
                : "bg-emerald-400",
          )}
        />
        {profile ? (
          <ProviderIcon provider={profile.provider} className="size-4 shrink-0" />
        ) : (
          <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-sm font-medium">{label}</span>
        {profile?.name && (
          <span
            className="max-w-40 truncate rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title={profile.name}
          >
            {profile.name}
          </span>
        )}
        <span className="ml-auto truncate text-[10px] text-muted-foreground">
          {exited
            ? t("exited")
            : status === "error"
              ? t("error")
              : status !== "ready"
                ? t("connecting")
                : busy
                  ? t("running")
                  : t("live")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("duplicate")}
          title={t("duplicate")}
          onClick={() => onDuplicate(workspace.id, pane)}
        >
          <PlusIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={maximized ? t("restore") : t("maximize")}
          onClick={() => onMaximize(pane.id)}
        >
          {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("closeTerminal")}
          onClick={() => onClose(workspace, pane)}
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden p-2">
        <div ref={container} className="h-full min-h-0 min-w-0" />
        {!rendered && status !== "ready" && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {status === "error" ? t("error") : t("connecting")}
          </span>
        )}
      </div>
      {status === "error" && (
        <p role="alert" className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {t("launchError")}
        </p>
      )}
    </section>
  );
});

export default function AgentWorkspacesView({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  const state = useAgentWorkspaceStore();
  const projects = useStore((s) => s.projects);
  const queryClient = useQueryClient();
  // The app's own accounts (normal sign-in + Settings → AI accounts), then workspace-only ones.
  const accounts = useWorkspaceAccounts(state.profiles);
  const readyAccounts = accounts.filter((account) => account.known?.status === "signedIn");
  const projectOptions = projects.filter((p) => p.kind === "project");
  const projectItems = [
    { value: "", label: t("customFolder") },
    ...projectOptions.map((p) => ({ value: p.id, label: p.name })),
    { value: BROWSE_FOLDER, label: t("browseFolderMenu") },
  ];
  const [addingAccount, setAddingAccount] = useState(false);
  const visibleWorkspaces = state.workspaces.filter((w) => !projectId || w.projectId === projectId);
  const active = visibleWorkspaces.find((w) => w.id === state.activeId) ?? visibleWorkspaces[0];
  const [dialog, setDialog] = useState<"workspace" | "terminal" | "profile" | null>(null);
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [provider, setProvider] = useState<AgentAccountProfile["provider"]>("codex");
  const [profileId, setProfileId] = useState("");
  const [count, setCount] = useState(1);
  const [returnToTerminal, setReturnToTerminal] = useState(false);
  const [signInProfile, setSignInProfile] = useState<AgentAccountProfile | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const activeId = active?.id;
  const visitedWorkspaces = useRef(new Set<string>());
  if (activeId) visitedWorkspaces.current.add(activeId);
  const [, updateView] = useState(0);
  const workspaceView = active ? getWorkspaceViewState(active.id) : null;
  const maximized = workspaceView?.maximized ?? null;
  const setMaximized = useCallback(
    (next: SetStateAction<string | null>) => {
      if (!activeId) return;
      const view = getWorkspaceViewState(activeId);
      view.maximized = typeof next === "function" ? next(view.maximized) : next;
      updateView((revision) => revision + 1);
    },
    [activeId],
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    workspace: AgentWorkspace;
    pane?: AgentWorkspacePane;
  } | null>(null);
  const [editing, setEditing] = useState<{ kind: "workspace" | "profile"; id: string } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (canvasRef.current && activeId) {
      canvasRef.current.scrollTop = maximized ? 0 : getWorkspaceViewState(activeId).scrollTop;
    }
  }, [activeId, maximized]);
  useLayoutEffect(() => {
    if (!activeId) return;
    const focusedPane = getWorkspaceViewState(activeId).focusedPane;
    if (focusedPane) terminalRuntimeRegistry.focus(buildTerminalRuntimeKey(activeId, focusedPane));
  }, [activeId]);
  useEffect(() => {
    workspaceTerminalSessions.sync(state.workspaces, accounts);
  }, [state.workspaces, accounts]);
  const maximizePane = useCallback(
    (id: string) => {
      if (!maximized && workspaceView) workspaceView.scrollTop = canvasRef.current?.scrollTop ?? 0;
      setMaximized((current) => (current === id ? null : id));
    },
    [maximized, workspaceView, setMaximized],
  );
  const closePane = useCallback(
    (workspace: AgentWorkspace, pane: AgentWorkspacePane) => setConfirmation({ workspace, pane }),
    [],
  );
  const duplicatePane = useCallback(
    (workspaceId: string, pane: AgentWorkspacePane) => {
      useAgentWorkspaceStore.getState().addTerminals(workspaceId, pane.profileId, 1, "run");
      setMaximized(null);
    },
    [setMaximized],
  );
  const pickWorkingFolder = async () => {
    setPickingFolder(true);
    setFolderError(null);
    try {
      const picked = await ensureNativeApi().dialogs.pickFolder();
      if (!picked) return;
      const project = projects.find((p) => p.kind === "project" && p.cwd === picked);
      setCwd(picked);
      setSelectedProject(project?.id ?? "");
      setName((current) =>
        current.trim()
          ? current
          : (project?.name ??
            picked
              .replace(/[\\/]+$/, "")
              .split(/[\\/]/)
              .pop() ??
            ""),
      );
    } catch {
      setFolderError(t("folderPickError"));
    } finally {
      setPickingFolder(false);
    }
  };
  const newWorkspace = () => {
    const project = projects.find((p) => p.id === projectId);
    setName(project?.name ?? "");
    setCwd(project?.cwd ?? "");
    setSelectedProject(project?.id ?? "");
    setFolderError(null);
    setEditing(null);
    setDialog("workspace");
  };
  const signIn = (account: WorkspaceAccount) => setSignInProfile(account);
  const startTerminal = (accountId: string | null) => {
    if (!active) return;
    if (accountId) state.selectProfile(accountId);
    state.addTerminals(active.id, accountId, 1, "run");
    setMaximized(null);
  };
  const newProfile = () => {
    setReturnToTerminal(false);
    setName("");
    setEditing(null);
    setDialog("profile");
  };
  const newTerminal = () => {
    setProfileId(state.selectedProfileId ?? "");
    setCount(1);
    setDialog("terminal");
  };
  const closeEditor = () => {
    setDialog(returnToTerminal && dialog === "profile" ? "terminal" : null);
    setReturnToTerminal(false);
    setEditing(null);
  };
  const closeSession = async (workspace: AgentWorkspace, pane: AgentWorkspacePane) => {
    await workspaceTerminalSessions.close(workspace.id, pane.id);
    const view = getWorkspaceViewState(workspace.id);
    if (view.focusedPane === pane.id) view.focusedPane = null;
    state.removePane(workspace.id, pane.id);
    if (maximized === pane.id) setMaximized(null);
  };
  const confirmClose = async () => {
    if (!confirmation) return;
    setClosing(true);
    try {
      if (confirmation.pane) await closeSession(confirmation.workspace, confirmation.pane);
      else {
        for (const pane of confirmation.workspace.panes)
          await closeSession(confirmation.workspace, pane);
        state.removeWorkspace(confirmation.workspace.id);
        removeWorkspaceViewState(confirmation.workspace.id);
      }
      setConfirmation(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setClosing(false);
    }
  };
  const launch = (action: AgentWorkspacePane["action"] = "run") => {
    if (action === "login") {
      const account = accounts.find((p) => p.id === profileId);
      if (account) {
        setDialog(null);
        setReturnToTerminal(true);
        signIn(account);
      }
      return;
    }
    if (!active) return;
    if (action === "run") state.selectProfile(profileId || null);
    state.addTerminals(active.id, profileId || null, action === "run" ? count : 1, action);
    setMaximized(null);
    setDialog(null);
  };
  return (
    <RouteInsetSurface>
      <header className="workspace-header [app-region:drag]">
        <div className="[app-region:no-drag]">
          <SidebarHeaderNavigationControls />
        </div>
        <h1 className="text-sm font-semibold tracking-tight">{t("title")}</h1>
        <span className="workspace-header-count tabular-nums">
          {t("terminalCount", { count: state.workspaces.reduce((n, w) => n + w.panes.length, 0) })}
        </span>
        <Button size="sm" className="ml-auto [app-region:no-drag]" onClick={newWorkspace}>
          <PlusIcon className="size-4" />
          {t("newWorkspace")}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden max-xl:flex-col">
        <aside className="workspace-sidebar" aria-label={t("organization")}>
          <div className="workspace-section-title">
            <span>{t("title")}</span>
            <button
              className="workspace-icon-button"
              aria-label={t("newWorkspace")}
              onClick={newWorkspace}
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {visibleWorkspaces.map((w) => (
              <div
                key={w.id}
                className="workspace-list-row group"
                data-active={active?.id === w.id || undefined}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
                  onClick={() => state.selectWorkspace(w.id)}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{w.name}</span>
                    <span className="block text-[11px] text-muted-foreground tabular-nums">
                      {t("terminalCount", { count: w.panes.length })}
                    </span>
                  </span>
                </button>
                <button
                  className="workspace-icon-button mr-1.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={t("closeWorkspace", { name: w.name })}
                  onClick={() => setConfirmation({ workspace: w })}
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            ))}
            {visibleWorkspaces.length === 0 && (
              <p className="px-2.5 py-2 text-xs leading-relaxed text-muted-foreground text-pretty">
                {t("workspaceHint")}
              </p>
            )}
          </div>
          <section className="workspace-accounts liquid-glass" aria-label={t("accounts")}>
            <div className="workspace-section-title px-1 pt-0">
              <span>{t("accounts")}</span>
              <span className="flex items-center gap-0.5">
                <RefreshWorkspaceAccounts />
                <button
                  className="workspace-icon-button"
                  aria-label={t("addAccount")}
                  onClick={newProfile}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </span>
            </div>
            <div className="workspace-accounts-list">
              {accounts.map((account) => {
                const used = state.workspaces.reduce(
                  (n, w) => n + w.panes.filter((pane) => pane.profileId === account.id).length,
                  0,
                );
                return (
                  <WorkspaceAccountRow
                    key={account.id}
                    profile={account}
                    providerLabel={PROVIDERS[account.provider]}
                    used={used}
                    {...(account.known ? { known: account.known } : {})}
                    {...(account.id.startsWith("default-") ? { mainLabel: t("mainTag") } : {})}
                    selected={state.selectedProfileId === account.id}
                    onSelect={() => {
                      state.selectProfile(account.id);
                      setProfileId(account.id);
                    }}
                    onSignIn={() => {
                      setReturnToTerminal(false);
                      signIn(account);
                    }}
                    {...(account.fromApp
                      ? {}
                      : {
                          onEdit: () => {
                            setEditing({ kind: "profile", id: account.id });
                            setName(account.name);
                            setProvider(account.provider);
                            setDialog("profile");
                          },
                        })}
                  />
                );
              })}
            </div>
            <p className="px-1 pt-1 text-[11px] leading-4 text-muted-foreground text-pretty">
              {t("accountsFromSettings")}
            </p>
          </section>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
            >
              <span className="flex-1">{error}</span>
              <button aria-label={t("dismiss")} onClick={() => setError(null)}>
                <XIcon className="size-4" />
              </button>
            </div>
          )}
          {active ? (
            <>
              <div className="workspace-toolbar">
                <div className="min-w-0 flex-1">
                  <button
                    className="max-w-full truncate text-sm font-semibold"
                    title={t("renameWorkspace")}
                    onClick={() => {
                      setEditing({ kind: "workspace", id: active.id });
                      setName(active.name);
                      setDialog("workspace");
                    }}
                  >
                    {active.name}
                  </button>
                  <p className="truncate text-[11px] text-muted-foreground" title={active.cwd}>
                    {active.cwd}
                  </p>
                </div>
                {active.panes.length > 1 && (
                  <div className="workspace-segmented" role="group">
                    <button
                      data-active={active.layout === "split" || undefined}
                      onClick={() => {
                        state.setLayout(active.id, "split");
                        setMaximized(null);
                      }}
                    >
                      {t("split")}
                    </button>
                    <button
                      data-active={active.layout === "grid" || undefined}
                      onClick={() => {
                        state.setLayout(active.id, "grid");
                        setMaximized(null);
                      }}
                    >
                      {t("grid")}
                    </button>
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={newTerminal}>
                  <PlusIcon className="size-3.5" />
                  {t("newTerminal")}
                </Button>
              </div>
              {active.panes.length === 0 && (
                <div className="workspace-empty">
                  <h2 className="text-xl font-semibold tracking-tight text-balance">
                    {t("startTitle")}
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground text-pretty">
                    {t("startDescription")}
                  </p>
                  <div className="workspace-start-grid">
                    {readyAccounts.map((account, index) => (
                      <button
                        key={account.id}
                        className="workspace-start-card liquid-glass"
                        style={{ animationDelay: `${index * 60}ms` }}
                        onClick={() => startTerminal(account.id)}
                      >
                        <ProviderIcon provider={account.provider} className="size-5" />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-[13px] font-medium">
                            {t("startWith", { provider: PROVIDERS[account.provider] })}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {account.known?.email ?? account.name}
                          </span>
                        </span>
                      </button>
                    ))}
                    <button
                      className="workspace-start-card liquid-glass"
                      style={{ animationDelay: `${readyAccounts.length * 60}ms` }}
                      onClick={() => startTerminal(null)}
                    >
                      <TerminalIcon className="size-5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-[13px] font-medium">{t("shell")}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {t("shellHint")}
                        </span>
                      </span>
                    </button>
                  </div>
                  <button className="workspace-text-button mt-5" onClick={newTerminal}>
                    {t("moreOptions")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="workspace-empty">
              <span className="workspace-hero-icon liquid-glass">
                <TerminalIcon className="size-6" />
              </span>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance">
                {t("welcomeTitle")}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground text-pretty">
                {t("welcomeDescription")}
              </p>
              <Button className="mt-6" onClick={newWorkspace}>
                <PlusIcon className="size-4" />
                {t("newWorkspace")}
              </Button>
              {readyAccounts.length > 0 && (
                <div className="mt-8 flex flex-col items-center gap-2.5">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {t("readyAccounts")}
                  </span>
                  <div className="flex flex-wrap justify-center gap-2">
                    {readyAccounts.map((account) => (
                      <span key={account.id} className="workspace-ready-chip">
                        <ProviderIcon provider={account.provider} className="size-3.5" />
                        <span className="max-w-48 truncate">
                          {account.known?.email ?? PROVIDERS[account.provider]}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {state.workspaces.map(
            (w) =>
              visitedWorkspaces.current.has(w.id) &&
              w.panes.length > 0 && (
                <div
                  key={w.id}
                  ref={w.id === activeId ? canvasRef : undefined}
                  data-active={w.id === activeId}
                  inert={w.id !== activeId}
                  aria-hidden={w.id !== activeId}
                  onScroll={(event) => {
                    if (!maximized)
                      getWorkspaceViewState(w.id).scrollTop = event.currentTarget.scrollTop;
                  }}
                  data-terminal-scroll-viewport
                  className={cn(
                    "agent-terminal-canvas",
                    w.layout === "split" && "agent-terminal-split",
                    maximized && active?.id === w.id && "agent-terminal-maximized",
                  )}
                  style={active?.id !== w.id ? { display: "none" } : undefined}
                >
                  {w.panes.map((pane) => (
                    <div
                      key={pane.id}
                      className="agent-terminal-cell"
                      style={
                        active?.id === w.id && maximized && maximized !== pane.id
                          ? { display: "none" }
                          : undefined
                      }
                    >
                      <TerminalPane
                        workspace={w}
                        pane={pane}
                        profile={resolveWorkspaceProfile(pane.profileId, accounts)}
                        maximized={maximized === pane.id}
                        workspaceVisible={w.id === activeId}
                        onMaximize={maximizePane}
                        onClose={closePane}
                        onDuplicate={duplicatePane}
                      />
                    </div>
                  ))}
                </div>
              ),
          )}
        </main>
      </div>
      {signInProfile && (
        <ProfileSignInDialog
          key={signInProfile.id}
          profile={signInProfile}
          providerLabel={PROVIDERS[signInProfile.provider]}
          onClose={() => {
            setSignInProfile(null);
            void queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_QUERY_KEY });
            if (returnToTerminal) {
              setProfileId(state.selectedProfileId ?? "");
              setDialog("terminal");
            }
            setReturnToTerminal(false);
          }}
          onUseAccount={() => {
            void queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_QUERY_KEY });
            state.selectProfile(signInProfile.id);
            setProfileId(signInProfile.id);
            setSignInProfile(null);
            if (returnToTerminal) setDialog("terminal");
            setReturnToTerminal(false);
          }}
        />
      )}
      <NewTerminalDialog
        open={dialog === "terminal"}
        onOpenChange={(open) => {
          if (!open && dialog === "terminal") setDialog(null);
        }}
        profiles={accounts}
        profileId={profileId}
        onProfileChange={setProfileId}
        count={count}
        onCountChange={setCount}
        onLaunch={launch}
        onAddAccount={() => {
          newProfile();
          setReturnToTerminal(true);
        }}
      />
      <Dialog
        open={dialog !== null && dialog !== "terminal"}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogPopup
          className="terminal-launch-dialog terminal-workspace-editor"
          bottomStickOnMobile={false}
        >
          <DialogTitle>
            {dialog === "workspace"
              ? editing
                ? t("renameWorkspace")
                : t("newWorkspace")
              : dialog === "profile"
                ? editing
                  ? t("editAccount")
                  : t("addAccount")
                : t("newTerminal")}
          </DialogTitle>
          <DialogDescription>
            {dialog === "profile"
              ? t(editing ? "accountHint" : "accountConnectHint")
              : dialog === "workspace"
                ? t("workspaceHint")
                : t("terminalHint")}
          </DialogDescription>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (dialog === "profile" && !editing) {
                const count = accounts.filter((p) => p.provider === provider).length;
                const label = name.trim() || `${PROVIDERS[provider]} ${count + 1}`;
                if (provider === "codex" || provider === "claudeAgent") {
                  const appProvider = provider;
                  // Claude Code and Codex accounts live in Settings → AI accounts, so chats and
                  // workspaces share one sign-in.
                  setAddingAccount(true);
                  void ensureNativeApi()
                    .cliAccounts.add({ provider: appProvider, name: label })
                    .then(async (account) => {
                      await queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_QUERY_KEY });
                      setProfileId(account.id);
                      setDialog(null);
                      setSignInProfile({ id: account.id, provider, name: label });
                    })
                    .catch((cause: unknown) => setError(String(cause)))
                    .finally(() => setAddingAccount(false));
                  return;
                }
                const id = state.addProfile(provider, label);
                setProfileId(id);
                setDialog(null);
                setSignInProfile({ id, provider, name: label });
                return;
              }
              if (!name.trim()) return;
              if (dialog === "workspace") {
                if (editing) state.renameWorkspace(editing.id, name);
                else if (cwd.trim()) state.addWorkspace(name, cwd, selectedProject || null);
                else return;
              } else if (dialog === "profile") {
                if (editing) state.renameProfile(editing.id, name);
                else setProfileId(state.addProfile(provider, name));
              }
              setDialog(returnToTerminal && dialog === "profile" ? "terminal" : null);
              setReturnToTerminal(false);
              setEditing(null);
            }}
          >
            <>
              {dialog === "profile" && !editing && (
                <div
                  role="radiogroup"
                  aria-label={t("provider")}
                  className="workspace-provider-grid"
                >
                  {(Object.keys(PROVIDERS) as AgentAccountProfile["provider"][]).map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={provider === id}
                      className="workspace-provider-tile"
                      onClick={() => setProvider(id)}
                    >
                      <ProviderIcon provider={id} className="size-5" />
                      <span>{PROVIDERS[id]}</span>
                    </button>
                  ))}
                </div>
              )}
              <label className="block space-y-2 text-xs">
                <span>{t(dialog === "profile" && !editing ? "accountLabelOptional" : "name")}</span>
                <input
                  autoFocus
                  required={dialog !== "profile" || !!editing}
                  maxLength={80}
                  className="workspace-text-field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    dialog === "profile" ? t("accountPlaceholder") : t("workspacePlaceholder")
                  }
                />
              </label>
              {dialog === "workspace" && !editing && (
                <>
                  <div className="block space-y-2 text-xs">
                    <span>{t("project")}</span>
                    <Select
                      items={projectItems}
                      value={selectedProject}
                      onValueChange={(value) => {
                        if (value === BROWSE_FOLDER) {
                          void pickWorkingFolder();
                          return;
                        }
                        const p = projects.find((project) => project.id === value);
                        setSelectedProject(value ?? "");
                        if (p) {
                          setCwd(p.cwd);
                          setName((current) => (current.trim() ? current : p.name));
                        }
                      }}
                    >
                      <SelectTrigger className="workspace-select-trigger" aria-label={t("project")}>
                        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-[13px] font-medium">
                            {projects.find((p) => p.id === selectedProject)?.name ??
                              (cwd.trim() ? folderName(cwd) : t("customFolder"))}
                          </span>
                          {cwd.trim() && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {cwd}
                            </span>
                          )}
                        </span>
                      </SelectTrigger>
                      <SelectPopup
                        alignItemWithTrigger={false}
                        sideOffset={6}
                        surface="settings"
                        shellClassName="terminal-launch-menu workspace-select-menu"
                      >
                        {projectOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="workspace-select-option">
                            <span className="workspace-select-option-row">
                              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">
                                  {p.name}
                                </span>
                                <span className="block truncate text-[11px] text-muted-foreground">
                                  {p.cwd}
                                </span>
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                        <SelectItem value={BROWSE_FOLDER} className="workspace-select-option">
                          <span className="workspace-select-option-row">
                            <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="text-[13px] font-medium">{t("browseFolderMenu")}</span>
                          </span>
                        </SelectItem>
                      </SelectPopup>
                    </Select>
                  </div>
                  <label className="block space-y-2 text-xs">
                    <span>{t("folder")}</span>
                    <div className="workspace-path-field">
                      <input
                        required
                        aria-label={t("folder")}
                        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                        value={cwd}
                        onChange={(e) => {
                          setCwd(e.target.value);
                          setSelectedProject(
                            projects.find((p) => p.kind === "project" && p.cwd === e.target.value)
                              ?.id ?? "",
                          );
                        }}
                        placeholder="/path/to/project"
                      />
                      <button
                        type="button"
                        className="workspace-icon-button"
                        aria-label={t("browseFolder")}
                        title={t("browseFolder")}
                        disabled={pickingFolder}
                        onClick={() => void pickWorkingFolder()}
                      >
                        <FolderOpenIcon className="size-4" />
                      </button>
                    </div>
                    {folderError && (
                      <span role="alert" className="text-destructive">
                        {folderError}
                      </span>
                    )}
                  </label>
                </>
              )}
            </>
            <DialogFooter>
              {dialog === "profile" && editing && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mr-auto text-destructive"
                  title={t("removeProfileHint")}
                  disabled={state.workspaces.some((w) =>
                    w.panes.some((p) => p.profileId === editing.id),
                  )}
                  onClick={() => {
                    state.removeProfile(editing.id);
                    closeEditor();
                  }}
                >
                  {t("removeProfile")}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={closeEditor}>
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  pickingFolder ||
                  addingAccount ||
                  ((dialog !== "profile" || !!editing) && !name.trim()) ||
                  (dialog === "workspace" && !editing && !cwd.trim())
                }
              >
                {editing
                  ? t("save")
                  : dialog === "profile"
                    ? t("signInWith", { provider: PROVIDERS[provider] })
                    : t("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
      <TerminalCloseDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !closing) setConfirmation(null);
        }}
        closing={closing}
        title={confirmation?.pane ? t("closeTerminal") : t("removeWorkspace")}
        description={t("closeHint")}
        cancelLabel={t("cancel")}
        confirmLabel={t("close")}
        closingLabel={t("closing")}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmClose()}
      />
    </RouteInsetSurface>
  );
}

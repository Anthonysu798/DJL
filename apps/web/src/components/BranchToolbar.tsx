// FILE: BranchToolbar.tsx
// Purpose: Renders the chat thread's compact workspace controls, including the
// local usage popover, inline workspace handoff actions, and runtime access toggle.
import type { ProviderKind, ThreadId, RuntimeMode } from "@synara/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HandoffIcon,
  WorktreeIcon,
} from "~/lib/icons";
import { HiOutlineCommandLine, HiOutlineHandRaised, HiOutlinePencilSquare } from "react-icons/hi2";
import { CentralIcon } from "~/lib/central-icons";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "~/appSettings";

import { newCommandId, cn } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useProviderUsageSummary } from "../hooks/useProviderUsageSummary";
import {
  deriveProviderUsageDisplayRows,
  selectPrimaryProviderUsageDisplayRow,
} from "../lib/providerUsageDisplay";
import { resolveThreadEnvironmentPresentation } from "../lib/threadEnvironment";
import { useStore } from "../store";
import {
  createAllThreadsSelector,
  createProjectSelector,
  createThreadSelector,
} from "../storeSelectors";
import {
  EnvMode,
  resolveAssociatedWorktreeMetadataAfterWorkspacePatch,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  runtimeModeOptionsForProvider,
} from "./BranchToolbar.logic";
import {
  BranchToolbarBranchSelector,
  type BranchSelectorVariant,
} from "./BranchToolbarBranchSelector";
import {
  RUNTIME_FULL_ACCESS_ACCENT_CLASS_NAME,
  COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
  COMPOSER_TOOLBAR_PICKER_TRIGGER_CLASS_NAME,
} from "./chat/composerPickerStyles";
import {
  ENVIRONMENT_ROW_CLASS_NAME,
  ENVIRONMENT_ROW_ICON_CLASS_NAME,
  EnvironmentRowBody,
  EnvironmentRowChevron,
} from "./chat/environment/EnvironmentRow";
import type { ContextWindowSnapshot } from "../lib/contextWindow";
import { ProviderUsagePanelContent } from "./ProviderUsagePanelContent";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel } from "./ui/collapsible";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import type { ThreadWorkspacePatch } from "../types";

function WorktreeGlyph({ className }: { className?: string }) {
  return <WorktreeIcon className={className} />;
}

/** Leading glyph treatment shared by every "Continue in" menu row (16px, muted). */
const ENV_MENU_ICON_CLASS_NAME = "size-3.5 text-muted-foreground";

/**
 * One row of the "Continue in" menu: `[glyph] [label …grows] [✓ when selected]`.
 * Centralizes the icon/label/check treatment so the local, worktree, and handoff
 * entries stay on one grid instead of repeating the same class strings per row.
 */
function ContinueInMenuItem({
  icon,
  label,
  selected = false,
  disabled = false,
  onSelect,
}: {
  icon: ReactNode;
  label: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <MenuItem disabled={disabled} {...(onSelect ? { onClick: onSelect } : {})}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? (
        <CheckIcon className="size-3.5 shrink-0 text-[var(--color-text-foreground)]" />
      ) : null}
    </MenuItem>
  );
}

export interface BranchToolbarProps {
  threadId: ThreadId;
  className?: string;
  onEnvModeChange: (mode: EnvMode) => void;
  envLocked: boolean;
  onHandoffToWorktree?: () => void;
  onHandoffToLocal?: () => void;
  handoffBusy?: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  // `toolbar` renders the compact composer-footer row; `panel` stacks the env and branch
  // pickers as full-width Environment panel rows that open downward.
  variant?: BranchSelectorVariant;
  // Keeps the Local/Worktree control visible while hiding Git-only branch UI for non-repo cwd.
  showBranchSelector?: boolean;
}

export interface RuntimeUsageControlsProps {
  runtimeMode?: RuntimeMode | undefined;
  provider: ProviderKind;
  onRuntimeModeChange?: ((mode: RuntimeMode) => void) | undefined;
  contextWindow?: ContextWindowSnapshot | null | undefined;
  cumulativeCostUsd?: number | null | undefined;
  activeContextWindowLabel?: string | null | undefined;
  pendingContextWindowLabel?: string | null | undefined;
  className?: string | undefined;
  // Force icon-only rendering regardless of container width. Used when the
  // control is relocated outside the composer footer (which provides the
  // @container the responsive sr-only fallback depends on).
  hideLabel?: boolean | undefined;
}

export function RuntimeUsageControls({
  runtimeMode,
  provider,
  onRuntimeModeChange,
  className,
  hideLabel = false,
}: RuntimeUsageControlsProps) {
  const { t } = useTranslation("workspace");
  const runtimeModeOptions = runtimeModeOptionsForProvider(provider);
  const runtimeModeLabel =
    runtimeMode === "full-access"
      ? t("branch.permissions.fullAccess")
      : runtimeMode === "auto-approval"
        ? t("branch.permissions.approveForMe")
        : runtimeMode === "accept-edits"
          ? t("branch.permissions.acceptEdits")
          : t("branch.permissions.askForApproval");
  const runtimeModeTitle =
    runtimeMode === "full-access"
      ? t("branch.permissions.fullAccessTitle")
      : runtimeMode === "auto-approval"
        ? t("branch.permissions.approveForMeTitle")
        : runtimeMode === "accept-edits"
          ? t("branch.permissions.acceptEditsTitle")
          : t("branch.permissions.askForApprovalTitle");
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-[var(--color-text-foreground-secondary)]",
        className,
      )}
    >
      {runtimeMode && onRuntimeModeChange ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="chrome"
                className={cn(
                  "min-w-0 shrink-0 justify-start gap-1.5 whitespace-nowrap px-2 [&_svg]:mx-0 sm:px-2.5",
                  COMPOSER_PICKER_TRIGGER_TEXT_CLASS_NAME,
                  runtimeMode === "full-access" && RUNTIME_FULL_ACCESS_ACCENT_CLASS_NAME,
                )}
                title={runtimeModeTitle}
              />
            }
          >
            <span className="inline-flex items-center gap-1.5">
              {runtimeMode === "full-access" ? (
                <CentralIcon name="shield-access" className="size-3.5 shrink-0" />
              ) : runtimeMode === "auto-approval" ? (
                <HiOutlineCommandLine className="size-3.5 shrink-0" />
              ) : runtimeMode === "accept-edits" ? (
                <HiOutlinePencilSquare className="size-3.5 shrink-0" />
              ) : (
                <HiOutlineHandRaised className="size-3.5 shrink-0" />
              )}
              <span className={cn("truncate", hideLabel ? "sr-only" : "@max-[480px]:sr-only")}>
                {runtimeModeLabel}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-3 shrink-0 opacity-70",
                  hideLabel ? "hidden" : "@max-[480px]:hidden",
                )}
              />
            </span>
          </MenuTrigger>
          <MenuPopup align="start" side="top" className="w-[min(24rem,calc(100vw-2rem))] min-w-72">
            <MenuGroup>
              <MenuGroupLabel>{t("branch.permissions.heading")}</MenuGroupLabel>
              <MenuRadioGroup
                value={runtimeMode}
                onValueChange={(value) => {
                  if (
                    !value ||
                    !runtimeModeOptions.includes(value as RuntimeMode) ||
                    value === runtimeMode
                  ) {
                    return;
                  }
                  onRuntimeModeChange(value);
                }}
              >
                <MenuRadioItem value="approval-required" className="items-start py-2.5">
                  <span className="inline-flex min-w-0 items-start gap-2.5">
                    <HiOutlineHandRaised className="mt-0.5 size-4 shrink-0" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span>{t("branch.permissions.askForApproval")}</span>
                      <span className="text-xs font-normal text-[var(--color-text-foreground-tertiary)]">
                        {t("branch.permissions.askForApprovalTitle")}
                      </span>
                    </span>
                  </span>
                </MenuRadioItem>
                {provider === "opencode" ? (
                  <MenuRadioItem value="auto-approval" className="items-start py-2.5">
                    <span className="inline-flex min-w-0 items-start gap-2.5">
                      <HiOutlineCommandLine className="mt-0.5 size-4 shrink-0" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span>{t("branch.permissions.approveForMe")}</span>
                        <span className="text-xs font-normal text-[var(--color-text-foreground-tertiary)]">
                          {t("branch.permissions.approveForMeTitle")}
                        </span>
                      </span>
                    </span>
                  </MenuRadioItem>
                ) : null}
                <MenuRadioItem
                  value="full-access"
                  className="items-start py-2.5 data-checked:text-[var(--runtime-full-access-accent)]"
                >
                  <span className="inline-flex min-w-0 items-start gap-2.5">
                    <CentralIcon name="shield-access" className="mt-0.5 size-4 shrink-0" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span>{t("branch.permissions.fullAccess")}</span>
                      <span className="text-xs font-normal text-[var(--color-text-foreground-tertiary)]">
                        {t("branch.permissions.fullAccessTitle")}
                      </span>
                    </span>
                  </span>
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}

export default function BranchToolbar({
  threadId,
  className,
  onEnvModeChange,
  envLocked,
  onHandoffToWorktree,
  onHandoffToLocal,
  handoffBusy = false,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  variant = "toolbar",
  showBranchSelector = true,
}: BranchToolbarProps) {
  const { t, i18n } = useTranslation("workspace");
  const isPanel = variant === "panel";
  const setThreadWorkspaceAction = useStore((store) => store.setThreadWorkspace);
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const threads = useStore(useRef(createAllThreadsSelector()).current);
  const { settings } = useAppSettings();

  const serverThread = useStore(useMemo(() => createThreadSelector(threadId), [threadId]));
  const activeProjectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = useStore(
    useMemo(() => createProjectSelector(activeProjectId), [activeProjectId]),
  );
  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch = serverThread?.branch ?? draftThread?.branch ?? null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeProvider =
    serverThread?.session?.provider ?? serverThread?.modelSelection.provider ?? null;
  const branchCwd = activeWorktreePath ?? activeProject?.cwd ?? null;
  const hasServerThread = serverThread !== undefined;
  const effectiveEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread,
    draftThreadEnvMode: draftThread?.envMode,
    serverThreadEnvMode: serverThread?.envMode,
  });
  const environmentPresentation = resolveThreadEnvironmentPresentation({
    envMode: effectiveEnvMode,
    worktreePath: activeWorktreePath,
  });
  const environmentLabel =
    environmentPresentation.mode === "worktree" ? t("branch.worktree") : t("branch.local");
  const localOptionLabel = t("branch.localProject");
  const worktreeOptionLabel = t("branch.worktree");

  const setThreadWorkspace = useCallback(
    (patch: ThreadWorkspacePatch) => {
      if (!activeThreadId) return;
      const branch = patch.branch !== undefined ? patch.branch : activeThreadBranch;
      const worktreePath =
        patch.worktreePath !== undefined ? patch.worktreePath : activeWorktreePath;
      const nextEnvMode =
        patch.envMode !== undefined ? patch.envMode : worktreePath ? "worktree" : effectiveEnvMode;
      const nextAssociatedWorktree = resolveAssociatedWorktreeMetadataAfterWorkspacePatch({
        branch,
        worktreePath,
        existingAssociatedWorktreePath: serverThread?.associatedWorktreePath ?? null,
        existingAssociatedWorktreeBranch: serverThread?.associatedWorktreeBranch ?? null,
        existingAssociatedWorktreeRef: serverThread?.associatedWorktreeRef ?? null,
        ...(patch.associatedWorktreePath !== undefined
          ? { patchAssociatedWorktreePath: patch.associatedWorktreePath }
          : {}),
        ...(patch.associatedWorktreeBranch !== undefined
          ? { patchAssociatedWorktreeBranch: patch.associatedWorktreeBranch }
          : {}),
        ...(patch.associatedWorktreeRef !== undefined
          ? { patchAssociatedWorktreeRef: patch.associatedWorktreeRef }
          : {}),
      });
      const api = readNativeApi();
      // If the effective cwd is about to change, stop the running session so the
      // next message creates a new one with the correct cwd.
      if (serverThread?.session && worktreePath !== activeWorktreePath && api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: activeThreadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      if (api && hasServerThread) {
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          envMode: nextEnvMode,
          branch,
          worktreePath,
          associatedWorktreePath: nextAssociatedWorktree.associatedWorktreePath,
          associatedWorktreeBranch: nextAssociatedWorktree.associatedWorktreeBranch,
          associatedWorktreeRef: nextAssociatedWorktree.associatedWorktreeRef,
        });
      }
      if (hasServerThread) {
        setThreadWorkspaceAction(activeThreadId, {
          envMode: nextEnvMode,
          branch,
          worktreePath,
          ...nextAssociatedWorktree,
        });
        return;
      }
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(threadId, {
        branch,
        worktreePath,
        envMode: nextDraftEnvMode,
      });
    },
    [
      activeThreadId,
      activeThreadBranch,
      serverThread?.session,
      activeWorktreePath,
      hasServerThread,
      setThreadWorkspaceAction,
      serverThread?.associatedWorktreePath,
      serverThread?.associatedWorktreeBranch,
      serverThread?.associatedWorktreeRef,
      setDraftThreadContext,
      threadId,
      effectiveEnvMode,
    ],
  );

  const canHandoffToWorktree = Boolean(
    hasServerThread && envLocked && !activeWorktreePath && effectiveEnvMode === "local",
  );
  const canHandoffToLocal = Boolean(hasServerThread && activeWorktreePath);
  const canSwitchToWorktree = Boolean(
    !envLocked && !activeWorktreePath && effectiveEnvMode === "local",
  );
  const canSwitchToLocal = Boolean(!envLocked && effectiveEnvMode === "worktree");
  const showEnvPicker = effectiveEnvMode === "local" || canSwitchToLocal;

  const usageSummary = useProviderUsageSummary({
    provider: activeProvider,
    threads,
    codexHomePath: settings.codexHomePath || null,
    fetchProviderData: false,
  });
  const primaryUsageRow = useMemo(
    () =>
      selectPrimaryProviderUsageDisplayRow(
        deriveProviderUsageDisplayRows(usageSummary.rateLimits, {
          t,
          locale: i18n.resolvedLanguage ?? i18n.language,
        }),
      ),
    [i18n.language, i18n.resolvedLanguage, t, usageSummary.rateLimits],
  );
  const [rateLimitsOpen, setRateLimitsOpen] = useState(true);
  const [envPickerOpen, setEnvPickerOpen] = useState(false);

  if (!activeThreadId || !activeProject) return null;

  const envGlyph = (className: string) =>
    environmentPresentation.mode === "local" ? (
      <CentralIcon name="macbook-air" className={className} />
    ) : (
      <WorktreeGlyph className={className} />
    );

  return (
    <div
      className={cn(
        isPanel
          ? "flex w-full flex-col gap-0.5"
          : "mx-auto flex w-full items-center justify-between px-3 pb-1.5 pt-1",
        className,
      )}
    >
      <div className={isPanel ? "flex flex-col gap-0.5" : "flex items-center gap-2"}>
        {showEnvPicker ? (
          <Menu open={envPickerOpen} onOpenChange={setEnvPickerOpen}>
            <MenuTrigger
              render={
                <button
                  type="button"
                  className={
                    isPanel
                      ? ENVIRONMENT_ROW_CLASS_NAME
                      : COMPOSER_TOOLBAR_PICKER_TRIGGER_CLASS_NAME
                  }
                />
              }
            >
              {isPanel ? (
                <EnvironmentRowBody
                  icon={envGlyph(ENVIRONMENT_ROW_ICON_CLASS_NAME)}
                  label={environmentLabel}
                  trailing={<EnvironmentRowChevron />}
                />
              ) : (
                <>
                  {envGlyph("size-3.5")}
                  {environmentLabel}
                  <ChevronDownIcon className="size-3 opacity-60" />
                </>
              )}
            </MenuTrigger>
            <ComposerPickerMenuPopup
              align="start"
              side={isPanel ? "bottom" : "top"}
              sideOffset={6}
              className="w-60 min-w-60"
            >
              <MenuGroup>
                <MenuGroupLabel>{t("branch.continueIn")}</MenuGroupLabel>
                {environmentPresentation.mode === "local" ? (
                  <ContinueInMenuItem
                    icon={<CentralIcon name="macbook-air" className={ENV_MENU_ICON_CLASS_NAME} />}
                    label={localOptionLabel}
                    selected
                  />
                ) : (
                  <ContinueInMenuItem
                    icon={<CentralIcon name="macbook-air" className={ENV_MENU_ICON_CLASS_NAME} />}
                    label={localOptionLabel}
                    onSelect={() => onEnvModeChange("local")}
                  />
                )}
                {canSwitchToWorktree ? (
                  <ContinueInMenuItem
                    icon={<WorktreeGlyph className={ENV_MENU_ICON_CLASS_NAME} />}
                    label={t("branch.newWorktree")}
                    onSelect={() => onEnvModeChange("worktree")}
                  />
                ) : null}
                {effectiveEnvMode === "worktree" && !canHandoffToLocal ? (
                  <ContinueInMenuItem
                    icon={<WorktreeGlyph className={ENV_MENU_ICON_CLASS_NAME} />}
                    label={worktreeOptionLabel}
                    selected
                  />
                ) : null}
                {canHandoffToWorktree && onHandoffToWorktree ? (
                  <ContinueInMenuItem
                    icon={<WorktreeGlyph className={ENV_MENU_ICON_CLASS_NAME} />}
                    label={t("branch.handoffWorktree")}
                    disabled={handoffBusy}
                    onSelect={() => onHandoffToWorktree()}
                  />
                ) : null}
                {canHandoffToLocal && onHandoffToLocal ? (
                  <ContinueInMenuItem
                    icon={<HandoffIcon className={ENV_MENU_ICON_CLASS_NAME} />}
                    label={t("branch.handoffLocal")}
                    disabled={handoffBusy}
                    onSelect={() => onHandoffToLocal()}
                  />
                ) : null}
              </MenuGroup>

              <MenuSeparator />

              <Collapsible open={rateLimitsOpen} onOpenChange={setRateLimitsOpen}>
                <MenuItem closeOnClick={false} onClick={() => setRateLimitsOpen((open) => !open)}>
                  <CentralIcon name="clock" className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {primaryUsageRow
                      ? t("branch.rateLimitsRemaining", { percent: primaryUsageRow.remainingLabel })
                      : t("branch.rateLimits")}
                  </span>
                  <ChevronRightIcon
                    className={cn(
                      "size-3.5 shrink-0 text-[var(--color-text-foreground-secondary)] transition-transform duration-150",
                      rateLimitsOpen && "rotate-90",
                    )}
                  />
                </MenuItem>
                <CollapsiblePanel>
                  <ProviderUsagePanelContent
                    provider={activeProvider}
                    rateLimits={usageSummary.rateLimits}
                    usageLines={usageSummary.usageLines}
                    notice={usageSummary.usageNotice}
                    isLoading={usageSummary.isLoading}
                    learnMoreHref={usageSummary.learnMoreHref}
                    showTitle={false}
                    showLearnMore={true}
                    className="px-2 pb-1 pt-1"
                  />
                </CollapsiblePanel>
              </Collapsible>
            </ComposerPickerMenuPopup>
          </Menu>
        ) : isPanel ? (
          <div className={cn(ENVIRONMENT_ROW_CLASS_NAME, "cursor-default hover:bg-transparent")}>
            <EnvironmentRowBody
              icon={<WorktreeGlyph className={ENVIRONMENT_ROW_ICON_CLASS_NAME} />}
              label={environmentLabel}
            />
          </div>
        ) : (
          <span className="inline-flex items-center gap-2 px-1.5 text-[length:var(--app-font-size-ui-sm,11px)] font-normal text-[var(--color-text-foreground-secondary)]">
            <WorktreeGlyph className="size-3.5" />
            {environmentLabel}
          </span>
        )}

        {showBranchSelector ? (
          <BranchToolbarBranchSelector
            activeProjectCwd={activeProject.cwd}
            activeThreadBranch={activeThreadBranch}
            activeWorktreePath={activeWorktreePath}
            branchCwd={branchCwd}
            effectiveEnvMode={effectiveEnvMode}
            envLocked={envLocked}
            hasServerThread={hasServerThread}
            onSetThreadWorkspace={setThreadWorkspace}
            variant={variant}
            {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
            {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
          />
        ) : null}
      </div>
    </div>
  );
}

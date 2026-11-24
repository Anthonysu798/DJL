// FILE: LocalModelHero.tsx
// Purpose: The one-path local AI setup for non-technical users: what this computer is, the model
//          that suits it for the chosen task, one install button with plain progress, and every
//          other model labelled by whether it fits this computer.
// Layer: Settings UI (local models)
// Exports: card view models, LocalModelSetupCard, LocalModelCatalog

import {
  CODING_HARNESS_MIN_CONTEXT_TOKENS,
  type LocalModelRecommendation,
  type LocalModelRecommendationSource,
  type LocalModelRuntimeStatus,
  type LocalModelSetupJob,
  type LocalModelSetupJobState,
  type LocalModelUseCase,
  type LocalModelsSnapshot,
} from "@djl/contracts";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  Loader2Icon,
  LockIcon,
  TriangleAlertIcon,
} from "~/lib/icons";
import { LOCAL_MODEL_USE_CASES } from "~/lib/localModelUseCaseStore";
import { cn } from "~/lib/utils";
import {
  SETTINGS_CARD_CLASS_NAME,
  SETTINGS_CARD_ROW_CLASS_NAME,
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
} from "~/settingsPanelStyles";
import { Button } from "../ui/button";
import { Stepper, StepperDescription, StepperItem, StepperTitle } from "../ui/stepper";
import { SettingsSegmentedControl } from "./SettingControls";
import { SettingsSection } from "./SettingsPanelPrimitives";

const GIB = 1024 ** 3;
const TERMINAL_SETUP_STATES = new Set(["ready", "failed", "cancelled"]);

export type LocalModelCardAction =
  | "setup"
  | "start"
  | "install"
  | "active"
  | "retry"
  | "installed"
  | "blocked_memory"
  | "blocked_free_memory"
  | "blocked_disk"
  | "blocked_busy"
  | "runtime_attention";

export type LocalModelCardViewModel = {
  readonly recommendation: LocalModelRecommendation;
  readonly source: LocalModelRecommendationSource;
  readonly runtime: LocalModelRuntimeStatus;
  readonly isBestFit: boolean;
  readonly action: LocalModelCardAction;
  readonly estimatedBytes: number;
  readonly requiredDiskBytes: number;
  readonly setupJob: LocalModelSetupJob | null;
  readonly progressPercent: number | null;
};

export function installProgressPercent(downloadedBytes: number, totalBytes: number | null) {
  if (!totalBytes || totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
}

function isActiveSetup(job: LocalModelSetupJob): boolean {
  return !TERMINAL_SETUP_STATES.has(job.state);
}

function bestFitId(snapshot: LocalModelsSnapshot, useCase: LocalModelUseCase): string | null {
  return snapshot.recommendedModelIdsByUseCase?.[useCase] ?? snapshot.recommendedModelId;
}

export function buildLocalModelCardViewModels(
  snapshot: LocalModelsSnapshot,
  useCase: LocalModelUseCase = "general",
): LocalModelCardViewModel[] {
  const runtime = snapshot.runtimes.find(({ runtime }) => runtime === "ollama");
  if (!runtime) return [];

  const bestId = bestFitId(snapshot, useCase);
  const catalogOrder = new Map(
    snapshot.recommendations.map((recommendation, index) => [recommendation.id, index]),
  );
  const recommendations = snapshot.recommendations.toSorted((left, right) => {
    if (left.id === bestId) return -1;
    if (right.id === bestId) return 1;
    return (
      left.minimumMemoryBytes - right.minimumMemoryBytes ||
      (catalogOrder.get(left.id) ?? 0) - (catalogOrder.get(right.id) ?? 0)
    );
  });
  const activeSetup = snapshot.setupJobs.find(isActiveSetup);
  const activeRuntimeInstall = snapshot.runtimeInstallJobs.some(
    (job) => job.runtime === "ollama" && !["completed", "failed"].includes(job.state),
  );

  return recommendations.flatMap((recommendation) => {
    const source = recommendation.sources.find(({ runtime }) => runtime === "ollama");
    if (!source) return [];

    const setupJob =
      snapshot.setupJobs.find(
        (job) => job.runtime === "ollama" && job.recommendationId === recommendation.id,
      ) ?? null;
    const installed = recommendation.sources.some((candidate) =>
      snapshot.installedModels.some(
        (model) => model.runtime === candidate.runtime && model.modelId === candidate.modelId,
      ),
    );
    const estimatedBytes =
      source.estimatedDownloadBytes +
      (runtime.state === "not_installed" ? runtime.estimatedDownloadBytes : 0);
    const requiredDiskBytes = estimatedBytes + Math.max(2 * GIB, Math.ceil(estimatedBytes * 0.1));

    let action: LocalModelCardAction;
    if (installed) {
      action = "installed";
    } else if (setupJob && isActiveSetup(setupJob)) {
      action = "active";
    } else if (setupJob?.state === "failed") {
      action = "retry";
    } else if (recommendation.minimumMemoryBytes > snapshot.totalMemoryBytes) {
      action = "blocked_memory";
    } else if (
      snapshot.fittingRecommendationIds &&
      !snapshot.fittingRecommendationIds.includes(recommendation.id)
    ) {
      // Enough memory in total, but not free right now: setup would refuse it.
      action = "blocked_free_memory";
    } else if (activeSetup || activeRuntimeInstall) {
      action = "blocked_busy";
    } else if (snapshot.freeDiskBytes !== null && snapshot.freeDiskBytes < requiredDiskBytes) {
      action = "blocked_disk";
    } else if (runtime.state === "not_installed") {
      action = "setup";
    } else if (runtime.state === "stopped") {
      action = "start";
    } else if (runtime.state === "running") {
      action = "install";
    } else {
      action = "runtime_attention";
    }

    return [
      {
        recommendation,
        source,
        runtime,
        isBestFit: recommendation.id === bestId,
        action,
        estimatedBytes,
        requiredDiskBytes,
        setupJob,
        progressPercent: setupJob
          ? installProgressPercent(setupJob.downloadedBytes, setupJob.totalBytes)
          : null,
      },
    ];
  });
}

/** The model the setup card is about: the one installing, else the best fit for the task. */
export function setupCardModel(cards: ReadonlyArray<LocalModelCardViewModel>) {
  return (
    cards.find(({ action }) => action === "active") ??
    cards.find(({ isBestFit }) => isBestFit) ??
    cards[0] ??
    null
  );
}

const SETUP_STEPS = ["prepare", "download", "test", "ready"] as const;

/** Maps the server's setup states onto the four steps a person can follow. */
export function setupStepIndex(state: LocalModelSetupJobState): number {
  switch (state) {
    case "detecting":
    case "installing_runtime":
    case "starting_runtime":
      return 0;
    case "downloading_model":
      return 1;
    case "verifying":
    case "synchronizing":
      return 2;
    default:
      return 3;
  }
}

export type LocalModelFit =
  | "installed"
  | "installing"
  | "failed"
  | "runsWell"
  | "lowFreeMemory"
  | "lowDisk"
  | "tooBig";

/** Whether a model suits this computer, in the terms the list labels it with. */
export function localModelFit(card: LocalModelCardViewModel): LocalModelFit {
  switch (card.action) {
    case "installed":
      return "installed";
    case "active":
      return "installing";
    case "retry":
      return "failed";
    case "blocked_memory":
      return "tooBig";
    case "blocked_free_memory":
      return "lowFreeMemory";
    case "blocked_disk":
      return "lowDisk";
    default:
      return "runsWell";
  }
}

const FIT_ORDER: Record<LocalModelFit, number> = {
  installing: 0,
  failed: 1,
  runsWell: 2,
  installed: 3,
  lowFreeMemory: 4,
  lowDisk: 5,
  tooBig: 6,
};

function formatBytes(bytes: number, t: TFunction): string {
  if (bytes <= 0) return t("localModels.sizeUnavailable", { ns: "settings" });
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  // "8 GB" reads better than "8.0 GB"; fractions like "2.1 GB" keep their decimal.
  const rounded = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded.replace(/\.0$/, "")} ${units[unitIndex]}`;
}

export type CodingToolsSupport = "works" | "tooShort";

/**
 * Whether Claude Code and Codex can run on this model. Chat-only models say so in their
 * description already, so they get no note.
 */
export function codingToolsSupport(
  recommendation: LocalModelRecommendation,
): CodingToolsSupport | null {
  const window = recommendation.contextWindowTokens;
  if (!recommendation.supportsToolCalls || !window) return null;
  return window >= CODING_HARNESS_MIN_CONTEXT_TOKENS ? "works" : "tooShort";
}

function CodingToolsNote({
  recommendation,
}: {
  readonly recommendation: LocalModelRecommendation;
}) {
  const { t } = useTranslation("settings");
  const support = codingToolsSupport(recommendation);
  if (!support) return null;
  const Icon = support === "works" ? CircleCheckIcon : CircleAlertIcon;
  return (
    <p
      className={cn(
        "mt-1 flex items-start gap-1.5 text-[11px]",
        support === "works" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400",
      )}
      data-coding-tools={support}
    >
      <Icon aria-hidden="true" className="mt-px size-3 shrink-0" />
      {t(`localModels.codingTools.${support}`, {
        window: `${Math.round((recommendation.contextWindowTokens ?? 0) / 1024)}k`,
      })}
    </p>
  );
}

function recommendationDescription(recommendation: LocalModelRecommendation, t: TFunction) {
  return t(`localModels.recommendations.${recommendation.id}.description`, {
    defaultValue: recommendation.description,
  });
}

type LocalModelActionCallbacks = {
  readonly actionPending: boolean;
  readonly onStartSetup: (recommendationId: string, useCase?: LocalModelUseCase) => void;
  readonly onRetrySetup: (jobId: string) => void;
  readonly onCancelSetup: (jobId: string) => void;
  readonly onRuntimeAttention: () => void;
  readonly onStartChat: () => void;
};

/** What DJL detected about this computer, in words a non-technical person recognises. */
function ComputerFacts({ snapshot }: { readonly snapshot: LocalModelsSnapshot }) {
  const { t } = useTranslation("settings");
  const { hardware } = snapshot;
  const facts = [
    {
      key: "processor",
      label: t("localModels.setup.facts.processor"),
      value: hardware.cpuModel ?? t("localModels.setup.facts.thisComputer"),
    },
    ...(hardware.acceleration === "discrete_gpu" && hardware.gpuName
      ? [{ key: "graphics", label: t("localModels.setup.facts.graphics"), value: hardware.gpuName }]
      : []),
    {
      key: "memory",
      label: t("localModels.setup.facts.memory"),
      value: formatBytes(snapshot.totalMemoryBytes, t),
    },
    ...(snapshot.freeDiskBytes === null
      ? []
      : [
          {
            key: "disk",
            label: t("localModels.setup.facts.disk"),
            value: formatBytes(snapshot.freeDiskBytes, t),
          },
        ]),
  ];
  return (
    <dl
      aria-label={t("localModels.setup.facts.label")}
      className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap"
    >
      {facts.map((fact) => (
        <div key={fact.key} className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{fact.label}</dt>
          <dd className="truncate text-xs font-medium text-foreground tabular-nums">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SetupProgress({
  card,
  actionPending,
  onCancelSetup,
}: {
  readonly card: LocalModelCardViewModel;
  readonly actionPending: boolean;
  readonly onCancelSetup: (jobId: string) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const job = card.setupJob;
  if (!job) return null;
  const current = setupStepIndex(job.state);
  const downloaded =
    job.totalBytes && job.totalBytes > 0
      ? t("localModels.setup.downloaded", {
          done: formatBytes(job.downloadedBytes, t),
          total: formatBytes(job.totalBytes, t),
        })
      : null;
  return (
    <div className="mt-5" role="status" aria-live="polite">
      <Stepper
        aria-label={t("localModels.setup.progressLabel", { model: card.recommendation.name })}
      >
        {SETUP_STEPS.map((step, index) => (
          <StepperItem
            key={step}
            step={index + 1}
            state={index < current ? "done" : index === current ? "loading" : "pending"}
            className="pb-4"
          >
            <StepperTitle className="text-xs leading-6">
              {t(`localModels.setup.steps.${step}`)}
            </StepperTitle>
            {index === current ? (
              <StepperDescription className="mt-0 text-[11px]">
                {index === 1 && downloaded ? downloaded : (job.message ?? null)}
                {index === 1 && card.progressPercent !== null ? (
                  <span className="mt-1.5 block h-1 w-full max-w-64 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
                      style={{ width: `${card.progressPercent}%` }}
                    />
                  </span>
                ) : null}
              </StepperDescription>
            ) : null}
          </StepperItem>
        ))}
      </Stepper>
      <Button
        className="mt-1"
        size="sm"
        variant="outline"
        disabled={actionPending}
        onClick={() => onCancelSetup(job.id)}
      >
        {t("actions.cancel", { ns: "common" })}
      </Button>
    </div>
  );
}

/** One line under the button saying what will happen or what is in the way. */
function setupHint(card: LocalModelCardViewModel, t: TFunction): string | null {
  switch (card.action) {
    case "setup":
      return t("localModels.setup.installsOllama");
    case "start":
      return t("localModels.setup.startsOllama");
    case "blocked_free_memory":
      return t("localModels.setup.freeMemory");
    case "blocked_disk":
      return t("localModels.setup.freeDisk", { size: formatBytes(card.requiredDiskBytes, t) });
    case "blocked_memory":
      return t("localModels.setup.tooBig", {
        size: formatBytes(card.recommendation.minimumMemoryBytes, t),
      });
    case "blocked_busy":
      return t("localModels.setup.busy");
    case "runtime_attention":
      return t("localModels.setup.ollamaAttention");
    default:
      return null;
  }
}

type LocalModelSetupCardProps = LocalModelActionCallbacks & {
  readonly snapshot: LocalModelsSnapshot;
  readonly useCase: LocalModelUseCase;
  readonly onUseCaseChange: (useCase: LocalModelUseCase) => void;
};

export function LocalModelSetupCard({
  snapshot,
  useCase,
  onUseCaseChange,
  ...actions
}: LocalModelSetupCardProps) {
  const { t } = useTranslation(["settings", "common"]);
  const card = setupCardModel(buildLocalModelCardViewModels(snapshot, useCase));
  if (!card) return null;

  const ready = card.action === "installed";
  const installing = card.action === "active";
  const failed = card.action === "retry";
  // Set by the server only when the measured speed disappointed and a smaller tier exists.
  const fallbackId = card.setupJob?.suggestedFallbackId ?? null;
  const fallback = fallbackId
    ? (snapshot.recommendations.find(({ id }) => id === fallbackId) ?? null)
    : null;
  const hint = setupHint(card, t);
  const fits = card.recommendation.minimumMemoryBytes <= snapshot.totalMemoryBytes;

  return (
    <section aria-labelledby="local-model-setup-title" className={SETTINGS_CARD_CLASS_NAME}>
      <div className="px-5 pt-5 pb-5">
        <h2
          id="local-model-setup-title"
          className="text-base font-semibold text-balance text-foreground"
        >
          {ready
            ? t("localModels.setup.readyTitle", { model: card.recommendation.name })
            : t("localModels.setup.title")}
        </h2>
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {ready ? t("localModels.setup.readyDescription") : t("localModels.setup.privacy")}
        </p>
        <ComputerFacts snapshot={snapshot} />
      </div>

      <div className={cn(SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME, "px-5 py-4")}>
        <p id="local-model-use-case-label" className="text-xs font-medium text-foreground">
          {t("localModels.setup.useCaseLegend")}
        </p>
        <div
          className={cn(
            "mt-2",
            (installing || actions.actionPending) && "pointer-events-none opacity-60",
          )}
          aria-disabled={installing || actions.actionPending}
        >
          <SettingsSegmentedControl
            value={useCase}
            onValueChange={onUseCaseChange}
            ariaLabel={t("localModels.setup.useCaseLegend")}
            options={LOCAL_MODEL_USE_CASES.map((value) => ({
              value,
              label: t(`localModels.setup.useCases.${value}`),
            }))}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t(`localModels.setup.useCaseHints.${useCase}`)}
        </p>
      </div>

      <div className={cn(SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME, "px-5 py-5")}>
        <p className="text-[11px] font-medium text-muted-foreground">
          {ready ? t("localModels.setup.installedLabel") : t("localModels.setup.bestMatch")}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-foreground">{card.recommendation.name}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {t("localModels.setup.downloadSize", {
              size: formatBytes(card.source.estimatedDownloadBytes, t),
            })}
          </span>
        </div>
        <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-muted-foreground">
          {recommendationDescription(card.recommendation, t)}
        </p>
        {fits ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {t("localModels.setup.fitReason", {
              need: formatBytes(card.recommendation.minimumMemoryBytes, t),
              have: formatBytes(snapshot.totalMemoryBytes, t),
            })}
          </p>
        ) : null}
        <CodingToolsNote recommendation={card.recommendation} />

        {installing ? (
          <SetupProgress
            card={card}
            actionPending={actions.actionPending}
            onCancelSetup={actions.onCancelSetup}
          />
        ) : (
          <>
            {failed && card.setupJob?.message ? (
              <p
                role="alert"
                className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-destructive"
              >
                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {card.setupJob.message}
              </p>
            ) : null}
            {ready && fallback && card.setupJob?.message ? (
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                {card.setupJob.message}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <SetupPrimaryButton card={card} useCase={useCase} {...actions} />
              {fallback ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actions.actionPending}
                  onClick={() => actions.onStartSetup(fallback.id)}
                >
                  {t("localModels.setup.switchToSmaller", { model: fallback.name })}
                </Button>
              ) : null}
            </div>
            {hint ? (
              <p className="mt-2 max-w-[65ch] text-[11px] leading-relaxed text-muted-foreground">
                {hint}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function SetupPrimaryButton({
  card,
  useCase,
  actionPending,
  onStartSetup,
  onRetrySetup,
  onRuntimeAttention,
  onStartChat,
}: LocalModelActionCallbacks & {
  readonly card: LocalModelCardViewModel;
  readonly useCase: LocalModelUseCase;
}) {
  const { t } = useTranslation("settings");
  switch (card.action) {
    case "installed":
      // An installed model is only useful in chat, so say so and go there.
      return (
        <Button size="sm" onClick={onStartChat}>
          {t("localModels.setup.startChat")}
        </Button>
      );
    case "retry":
      return (
        <Button
          size="sm"
          disabled={actionPending}
          onClick={() => card.setupJob && onRetrySetup(card.setupJob.id)}
        >
          {t("localModels.setup.tryAgain")}
        </Button>
      );
    case "runtime_attention":
      return (
        <Button size="sm" variant="outline" onClick={onRuntimeAttention}>
          {t("localModels.setup.fixOllama")}
        </Button>
      );
    default: {
      const blocked = card.action.startsWith("blocked_");
      return (
        <Button
          size="sm"
          disabled={blocked || actionPending}
          // The best fit comes from the chosen task, so setup is told which task it is for.
          onClick={() => onStartSetup(card.recommendation.id, card.isBestFit ? useCase : undefined)}
        >
          {actionPending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {t("localModels.setup.install", { model: card.recommendation.name })}
        </Button>
      );
    }
  }
}

const FIT_TONE: Record<LocalModelFit, string> = {
  installed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  installing: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  runsWell: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  lowFreeMemory: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  lowDisk: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  tooBig: "bg-muted text-muted-foreground",
};

type LocalModelCatalogProps = LocalModelActionCallbacks & {
  readonly snapshot: LocalModelsSnapshot;
  readonly useCase: LocalModelUseCase;
};

/** Every model the setup card is not about, each labelled by whether it suits this computer. */
export function LocalModelCatalog({ snapshot, useCase, ...actions }: LocalModelCatalogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const cards = buildLocalModelCardViewModels(snapshot, useCase);
  const featured = setupCardModel(cards);
  const rows = cards
    .filter((card) => card !== featured)
    .toSorted(
      (left, right) =>
        FIT_ORDER[localModelFit(left)] - FIT_ORDER[localModelFit(right)] ||
        left.recommendation.minimumMemoryBytes - right.recommendation.minimumMemoryBytes,
    );
  if (rows.length === 0) return null;

  return (
    <SettingsSection title={t("localModels.list.title")}>
      {rows.map((card, index) => {
        const fit = localModelFit(card);
        return (
          <div
            key={card.recommendation.id}
            className={cn(
              SETTINGS_CARD_ROW_CLASS_NAME,
              index > 0 && SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME,
            )}
            data-fit={fit}
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>
                    {card.recommendation.name}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      FIT_TONE[fit],
                    )}
                  >
                    {t(`localModels.fit.${fit}`)}
                  </span>
                </div>
                <p className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "mt-0.5")}>
                  {recommendationDescription(card.recommendation, t)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {t("localModels.list.meta", {
                    size: formatBytes(card.source.estimatedDownloadBytes, t),
                    memory: formatBytes(card.recommendation.minimumMemoryBytes, t),
                  })}
                </p>
                <CodingToolsNote recommendation={card.recommendation} />
              </div>
              <CatalogRowAction card={card} {...actions} />
            </div>
          </div>
        );
      })}
    </SettingsSection>
  );
}

function CatalogRowAction({
  card,
  actionPending,
  onStartSetup,
  onRetrySetup,
  onCancelSetup,
}: LocalModelActionCallbacks & { readonly card: LocalModelCardViewModel }) {
  const { t } = useTranslation(["settings", "common"]);
  switch (card.action) {
    case "active":
      return (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {card.progressPercent === null ? null : `${card.progressPercent}%`}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={actionPending}
            onClick={() => card.setupJob && onCancelSetup(card.setupJob.id)}
          >
            {t("actions.cancel", { ns: "common" })}
          </Button>
        </div>
      );
    case "retry":
      return (
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          disabled={actionPending}
          onClick={() => card.setupJob && onRetrySetup(card.setupJob.id)}
        >
          {t("localModels.setup.tryAgain")}
        </Button>
      );
    case "setup":
    case "start":
    case "install":
    case "blocked_busy":
      return (
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          disabled={card.action === "blocked_busy" || actionPending}
          aria-label={t("localModels.setup.install", { model: card.recommendation.name })}
          onClick={() => onStartSetup(card.recommendation.id)}
        >
          {t("localModels.list.install")}
        </Button>
      );
    default:
      // Installed, or blocked for a reason the label already states.
      return null;
  }
}

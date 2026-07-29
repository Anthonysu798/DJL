import type {
  LocalHardwareProfile,
  LocalModelRecommendation,
  LocalModelRecommendationSource,
  LocalModelRuntimeStatus,
  LocalModelSetupJob,
  LocalModelsSnapshot,
} from "@synara/contracts";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { CheckCircle2Icon, Loader2Icon, SparklesIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
} from "~/settingsPanelStyles";
import { Button } from "../ui/button";
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

export function buildLocalModelCardViewModels(
  snapshot: LocalModelsSnapshot,
): LocalModelCardViewModel[] {
  const runtime = snapshot.runtimes.find(({ runtime }) => runtime === "ollama");
  if (!runtime) return [];

  const catalogOrder = new Map(
    snapshot.recommendations.map((recommendation, index) => [recommendation.id, index]),
  );
  const recommendations = [...snapshot.recommendations].sort((left, right) => {
    if (left.id === snapshot.recommendedModelId) return -1;
    if (right.id === snapshot.recommendedModelId) return 1;
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
        isBestFit: recommendation.id === snapshot.recommendedModelId,
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

function formatBytes(bytes: number, t: TFunction): string {
  if (bytes <= 0) return t("localModels.sizeUnavailable", { ns: "settings" });
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

// Describes the machine in the words a non-technical user would recognise, so the recommendation
// below it reads as a decision made for them rather than a menu.
export function hardwareSummary(hardware: LocalHardwareProfile, t: TFunction): string {
  const memory = formatBytes(hardware.totalMemoryBytes, t);
  const processor = hardware.cpuModel ?? t("localModels.hero.unknownProcessor");
  return hardware.acceleration === "discrete_gpu" && hardware.gpuName
    ? t("localModels.hero.detectedWithGpu", { processor, gpu: hardware.gpuName, memory })
    : t("localModels.hero.detected", { processor, memory });
}

type LocalModelActionCallbacks = {
  readonly actionPending: boolean;
  readonly onStartSetup: (recommendationId: string) => void;
  readonly onRetrySetup: (jobId: string) => void;
  readonly onCancelSetup: (jobId: string) => void;
  readonly onRuntimeAttention: () => void;
  readonly onStartChat: () => void;
};

type LocalModelHeroProps = LocalModelActionCallbacks & {
  readonly snapshot: LocalModelsSnapshot;
};

export function LocalModelHero({ snapshot, ...actions }: LocalModelHeroProps) {
  const { t } = useTranslation(["settings", "common"]);
  const cards = buildLocalModelCardViewModels(snapshot);
  const card = cards[0];
  if (!card) return null;

  const ready = card.action === "installed";
  // Set by the server only when the measured speed disappointed and a smaller tier exists.
  const fallbackId = card.setupJob?.suggestedFallbackId ?? null;
  const fallback = fallbackId
    ? (snapshot.recommendations.find(({ id }) => id === fallbackId) ?? null)
    : null;
  return (
    <section
      aria-labelledby="local-model-hero-title"
      className="overflow-hidden rounded-xl border bg-card p-5 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {ready ? (
            <CheckCircle2Icon className="size-4.5" />
          ) : card.action === "active" ? (
            <Loader2Icon className="size-4.5 animate-spin" />
          ) : (
            <SparklesIcon className="size-4.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="local-model-hero-title" className="text-sm font-medium text-foreground">
            {ready
              ? t("localModels.hero.readyTitle", { model: card.recommendation.name })
              : t("localModels.hero.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {hardwareSummary(snapshot.hardware, t)}
          </p>

          <div className="mt-4 rounded-lg bg-muted/40 px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {card.recommendation.name}
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {t("localModels.hero.fastOnYourHardware")}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t(`localModels.recommendations.${card.recommendation.id}.description`, {
                defaultValue: card.recommendation.description,
              })}
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t("localModels.shelf.downloadSize", {
                size: formatBytes(card.source.estimatedDownloadBytes, t),
              })}
            </p>
          </div>

          {/* Once installed the hero title carries the outcome, so the job message is redundant —
              except when it is a speed complaint, which is the reason the downgrade button exists. */}
          {card.setupJob && (!ready || fallback) ? (
            <div className="mt-3">
              <p
                className={cn(
                  "text-[11px] leading-relaxed",
                  card.setupJob.state === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {card.setupJob.message ?? card.setupJob.state}
              </p>
              {card.action === "active" ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full bg-primary transition-[width]",
                      card.progressPercent === null && "w-1/3 animate-pulse",
                    )}
                    style={
                      card.progressPercent === null
                        ? undefined
                        : { width: `${card.progressPercent}%` }
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* The verdict text is already rendered above; this only adds the way out, so the user is
              not left to work out which smaller model to pick. */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <CardActionButton card={card} {...actions} />
            </div>
            {fallback ? (
              <Button
                className="sm:w-auto"
                size="sm"
                variant="outline"
                disabled={actions.actionPending}
                onClick={() => actions.onStartSetup(fallback.id)}
              >
                {t("localModels.hero.switchToSmaller", { model: fallback.name })}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

type LocalModelAlternativesProps = LocalModelActionCallbacks & {
  readonly snapshot: LocalModelsSnapshot;
};

// Everything the hero did not choose. Kept as a plain list so it reads as reference material rather
// than a second decision competing with the recommendation.
export function LocalModelAlternatives({ snapshot, ...actions }: LocalModelAlternativesProps) {
  const { t } = useTranslation(["settings", "common"]);
  const cards = buildLocalModelCardViewModels(snapshot).slice(1);
  if (cards.length === 0) return null;

  return (
    <SettingsSection title={t("localModels.hero.alternativesTitle")}>
      {cards.map((card) => (
        <div key={card.recommendation.id} className="px-4 py-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>{card.recommendation.name}</div>
                {card.action === "installed" ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    {t("localModels.installed")}
                  </span>
                ) : card.action === "blocked_memory" ? (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    {t("localModels.shelf.tooLarge")}
                  </span>
                ) : null}
              </div>
              <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
                {t(`localModels.recommendations.${card.recommendation.id}.description`, {
                  defaultValue: card.recommendation.description,
                })}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t("localModels.shelf.downloadSize", {
                  size: formatBytes(card.source.estimatedDownloadBytes, t),
                })}
              </p>
            </div>
            <div className="shrink-0 sm:w-52">
              <CardActionButton card={card} {...actions} />
            </div>
          </div>
        </div>
      ))}
    </SettingsSection>
  );
}

function CardActionButton({
  card,
  actionPending,
  onStartSetup,
  onRetrySetup,
  onCancelSetup,
  onRuntimeAttention,
  onStartChat,
}: {
  readonly card: LocalModelCardViewModel;
  readonly actionPending: boolean;
  readonly onStartSetup: (recommendationId: string) => void;
  readonly onRetrySetup: (jobId: string) => void;
  readonly onCancelSetup: (jobId: string) => void;
  readonly onRuntimeAttention: () => void;
  readonly onStartChat: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const memory = formatBytes(card.recommendation.minimumMemoryBytes, t);
  const disk = formatBytes(card.requiredDiskBytes, t);

  if (card.action === "active") {
    return (
      <Button
        className="w-full"
        size="sm"
        variant="outline"
        disabled={actionPending}
        onClick={() => card.setupJob && onCancelSetup(card.setupJob.id)}
      >
        {t("actions.cancel", { ns: "common" })}
      </Button>
    );
  }
  if (card.action === "retry") {
    return (
      <Button
        className="w-full"
        size="sm"
        disabled={actionPending}
        onClick={() => card.setupJob && onRetrySetup(card.setupJob.id)}
      >
        {t("localModels.shelf.retry")}
      </Button>
    );
  }
  if (card.action === "installed") {
    // An installed model is only useful in chat, so say so and go there. Navigation is a callback
    // like every other action here, which keeps this component presentational and testable.
    return (
      <Button className="w-full" size="sm" variant="secondary" onClick={onStartChat}>
        {t("localModels.shelf.startChat")}
      </Button>
    );
  }
  if (card.action === "blocked_memory") {
    return (
      <Button className="w-full" size="sm" variant="outline" disabled>
        {t("localModels.shelf.requiresMemoryAction", { size: memory })}
      </Button>
    );
  }
  if (card.action === "blocked_disk") {
    return (
      <Button className="w-full" size="sm" variant="outline" disabled>
        {t("localModels.shelf.requiresDiskAction", { size: disk })}
      </Button>
    );
  }
  if (card.action === "blocked_busy") {
    return (
      <Button className="w-full" size="sm" variant="outline" disabled>
        {t("localModels.shelf.waitForSetup")}
      </Button>
    );
  }
  if (card.action === "runtime_attention") {
    return (
      <Button className="w-full" size="sm" variant="outline" onClick={onRuntimeAttention}>
        {t("localModels.shelf.fixOllama")}
      </Button>
    );
  }

  const label =
    card.action === "setup"
      ? t("localModels.shelf.setupOllama")
      : card.action === "start"
        ? t("localModels.shelf.startOllama")
        : t("localModels.shelf.installModel");
  return (
    <Button
      className="w-full"
      size="sm"
      disabled={actionPending}
      onClick={() => onStartSetup(card.recommendation.id)}
    >
      {actionPending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
      {label}
    </Button>
  );
}

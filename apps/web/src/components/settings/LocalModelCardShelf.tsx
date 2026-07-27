import type {
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
import { Button } from "../ui/button";

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

type LocalModelCardShelfProps = {
  readonly snapshot: LocalModelsSnapshot;
  readonly actionPending: boolean;
  readonly onStartSetup: (recommendationId: string) => void;
  readonly onRetrySetup: (jobId: string) => void;
  readonly onCancelSetup: (jobId: string) => void;
  readonly onRuntimeAttention: () => void;
};

export function LocalModelCardShelf({
  snapshot,
  actionPending,
  onStartSetup,
  onRetrySetup,
  onCancelSetup,
  onRuntimeAttention,
}: LocalModelCardShelfProps) {
  const { t } = useTranslation(["settings", "common"]);
  const cards = buildLocalModelCardViewModels(snapshot);

  return (
    <section aria-labelledby="local-model-shelf-title">
      <div className="mb-3">
        <h2 id="local-model-shelf-title" className="text-sm font-medium text-foreground">
          {t("localModels.shelf.title")}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("localModels.shelf.description")}
        </p>
      </div>
      <div
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3"
        role="region"
        aria-label={t("localModels.shelf.ariaLabel")}
        tabIndex={0}
      >
        {cards.map((card) => (
          <article
            key={card.recommendation.id}
            className={cn(
              "flex min-h-64 w-[16.5rem] shrink-0 snap-start flex-col rounded-xl border bg-card p-4 shadow-xs",
              card.isBestFit && "border-primary/40 ring-1 ring-primary/10",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {card.action === "installed" ? (
                  <CheckCircle2Icon className="size-4" />
                ) : card.action === "active" ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <SparklesIcon className="size-4" />
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {card.isBestFit ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {t("localModels.bestFit")}
                  </span>
                ) : null}
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
            </div>

            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {card.recommendation.name}
            </h3>
            <p className="mt-1 min-h-10 text-xs leading-relaxed text-muted-foreground">
              {t(`localModels.recommendations.${card.recommendation.id}.description`, {
                defaultValue: card.recommendation.description,
              })}
            </p>
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              <p>
                {t("localModels.shelf.requiresMemory", {
                  size: formatBytes(card.recommendation.minimumMemoryBytes, t),
                })}
              </p>
              <p>
                {t("localModels.shelf.downloadSize", {
                  size: formatBytes(card.source.estimatedDownloadBytes, t),
                })}
              </p>
            </div>

            {card.setupJob ? (
              <div className="mt-3">
                <p
                  className={cn(
                    "line-clamp-2 text-[11px] leading-relaxed",
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

            <div className="mt-auto pt-4">
              <CardActionButton
                card={card}
                actionPending={actionPending}
                onStartSetup={onStartSetup}
                onRetrySetup={onRetrySetup}
                onCancelSetup={onCancelSetup}
                onRuntimeAttention={onRuntimeAttention}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CardActionButton({
  card,
  actionPending,
  onStartSetup,
  onRetrySetup,
  onCancelSetup,
  onRuntimeAttention,
}: {
  readonly card: LocalModelCardViewModel;
  readonly actionPending: boolean;
  readonly onStartSetup: (recommendationId: string) => void;
  readonly onRetrySetup: (jobId: string) => void;
  readonly onCancelSetup: (jobId: string) => void;
  readonly onRuntimeAttention: () => void;
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
    return (
      <Button className="w-full" size="sm" variant="secondary" disabled>
        {t("localModels.shelf.installedReady")}
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

// FILE: GroupMissionCard.tsx
// Purpose: One mission in a group chat: the goal beside a progress ring, the steps (each with
//          its agent's icon and a status mark), Start / Stop / Retry / Skip, and the recap.
// Layer: UI component

import type { Group, GroupMission } from "@djl/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { CheckIcon, CopyIcon, TrophyIcon, XIcon } from "~/lib/icons";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { GroupAgentAvatar } from "./GroupAgentAvatar";
import { missionProgress } from "./groupChat.logic";

type T = ReturnType<typeof useTranslation<"shell">>["t"];

function ProgressRing(props: { done: number; total: number; complete: boolean }) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const share = props.total === 0 ? 0 : props.done / props.total;
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3"
          className="stroke-[color-mix(in_srgb,var(--color-text-foreground)_10%,transparent)]"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none",
            props.complete ? "stroke-emerald-500" : "stroke-foreground",
          )}
        />
      </svg>
      {props.complete ? (
        <TrophyIcon className="size-4 text-emerald-500" />
      ) : (
        <span className="text-[10px] font-medium tabular-nums">
          {props.done}/{props.total}
        </span>
      )}
    </span>
  );
}

function StepMark(props: { status: GroupMission["steps"][number]["status"] }) {
  const base = "flex size-4 shrink-0 items-center justify-center rounded-full";
  switch (props.status) {
    case "done":
      return (
        <span className={cn(base, "animate-in bg-emerald-500 text-white duration-300 zoom-in-50")}>
          <CheckIcon className="size-2.5" />
        </span>
      );
    case "running":
      return (
        <span
          className={cn(
            base,
            "animate-spin border-2 border-foreground/20 border-t-foreground motion-reduce:animate-none",
          )}
        />
      );
    case "failed":
      return (
        <span className={cn(base, "bg-destructive text-white")}>
          <XIcon className="size-2.5" />
        </span>
      );
    case "skipped":
      return <span className={cn(base, "border border-dashed border-muted-foreground/40")} />;
    default:
      return <span className={cn(base, "border border-[color:var(--color-border)]")} />;
  }
}

export function formatMissionDuration(t: T, ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60
    ? t("multiAgents.mission.durationSeconds", { count: seconds })
    : t("multiAgents.mission.durationMinutes", { count: Math.round(seconds / 60) });
}

/** The mission as plain text, for Copy summary. */
export function missionSummaryText(t: T, mission: GroupMission, group: Group): string {
  const handleOf = (memberId: string) =>
    group.members.find((member) => member.id === memberId)?.handle ?? "?";
  const marks = { done: "✓", failed: "✗", skipped: "–", running: "…", pending: "○" } as const;
  const stats = [
    t("multiAgents.mission.statsFiles", { count: mission.stats.files.length }),
    t("multiAgents.mission.statsCommands", { count: mission.stats.commands }),
    t("multiAgents.mission.statsReviews", { count: mission.stats.reviews }),
    ...(mission.startedAt !== null && mission.finishedAt !== null
      ? [formatMissionDuration(t, mission.finishedAt - mission.startedAt)]
      : []),
  ];
  return [
    `🎯 ${mission.goal}`,
    ...mission.steps.map(
      (step, index) =>
        `${marks[step.status]} ${index + 1}. @${handleOf(step.memberId)} ${step.text}`,
    ),
    stats.join(" · "),
  ].join("\n");
}

export function GroupMissionCard(props: { group: Group; mission: GroupMission }) {
  const { t } = useTranslation("shell");
  const { group, mission } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard<void>({
    timeout: 1600,
    onError: (cause) =>
      toastManager.add({
        type: "error",
        title: t("copy.failed", { ns: "chat" }),
        description: cause.message,
      }),
  });
  // Celebrate only a mission seen finishing, not every finished one on screen.
  const seenStatus = useRef(mission.status);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (mission.status === "done" && seenStatus.current !== "done") setCelebrate(true);
    seenStatus.current = mission.status;
  }, [mission.status]);

  const progress = missionProgress(mission);
  const member = (memberId: string | null) =>
    group.members.find((entry) => entry.id === memberId) ?? null;
  const planner = member(mission.plannerMemberId);
  const ref = { groupId: group.id, missionId: mission.id };
  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await run();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : t("multiAgents.mission.failedAction"),
      );
    } finally {
      setBusy(false);
    }
  };
  const api = () => ensureNativeApi().groups;
  const start = (skipCurrent = false) =>
    act(() =>
      api().missionStart({
        ...ref,
        ...(skipCurrent ? { skipCurrent: true } : {}),
        message: skipCurrent
          ? t("multiAgents.mission.skipText")
          : mission.status === "paused"
            ? t("multiAgents.mission.retryText")
            : t("multiAgents.mission.startText", { goal: mission.goal }),
      }),
    );
  const planAgain = () =>
    act(() =>
      api().missionPlan({
        groupId: group.id,
        goal: mission.goal,
        message: t("multiAgents.mission.planText", { goal: mission.goal }),
      }),
    );

  const done = mission.status === "done";
  const statusLabel = t(`multiAgents.mission.status.${mission.status}`);

  return (
    <section
      data-testid="group-mission-card"
      data-status={mission.status}
      aria-label={`${t("multiAgents.mission.label")}: ${mission.goal}`}
      className={cn(
        "mt-2 rounded-2xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] p-4",
        done && "border-emerald-500/30",
        celebrate && "animate-[group-mission-complete_900ms_ease-out_1] motion-reduce:animate-none",
      )}
    >
      <header className="flex items-center gap-3">
        <ProgressRing done={progress.done} total={progress.total} complete={done} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm leading-snug font-medium wrap-break-word">{mission.goal}</h3>
          <p
            className={cn(
              "mt-0.5 text-[11px] text-muted-foreground",
              (mission.status === "running" || done) && "text-emerald-600 dark:text-emerald-400",
              mission.status === "paused" && "text-amber-600 dark:text-amber-400",
              mission.status === "failed" && "text-destructive",
            )}
          >
            {done ? t("multiAgents.mission.completeTitle") : statusLabel}
          </p>
        </div>
      </header>

      {mission.status === "planning" ? (
        <div className="mt-3 flex flex-col gap-2" aria-live="polite">
          <p className="shimmer text-xs text-[var(--color-text-foreground-secondary)]">
            {t("multiAgents.mission.planning", { name: planner?.handle ?? "" })}
          </p>
          {[0, 1, 2].map((line) => (
            <span
              key={line}
              aria-hidden
              className="h-3 animate-pulse rounded-full bg-foreground/[0.06] motion-reduce:animate-none"
              style={{ width: `${80 - line * 18}%` }}
            />
          ))}
        </div>
      ) : null}

      {mission.steps.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1" data-testid="group-mission-steps">
          {mission.steps.map((step, index) => {
            const owner = member(step.memberId);
            return (
              <li
                key={`${index}:${step.text}`}
                data-status={step.status}
                className={cn(
                  "group/step flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors duration-200",
                  step.status === "running" &&
                    "bg-[var(--color-background-button-secondary-hover)]",
                )}
              >
                <span className="mt-0.5">
                  <StepMark status={step.status} />
                </span>
                {owner ? (
                  <span className="mt-px flex shrink-0" title={owner.handle}>
                    <GroupAgentAvatar provider={owner.provider} size="xs" />
                  </span>
                ) : null}
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[13px] leading-snug wrap-break-word",
                    (step.status === "done" || step.status === "skipped") &&
                      "text-muted-foreground",
                    step.status === "skipped" && "line-through",
                  )}
                >
                  {step.text}
                </span>
                {mission.status === "ready" ? (
                  <button
                    type="button"
                    aria-label={t("multiAgents.mission.removeStep")}
                    title={t("multiAgents.mission.removeStep")}
                    className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] duration-150 group-hover/step:opacity-100 hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => void act(() => api().missionRemoveStep({ ...ref, index }))}
                  >
                    <XIcon className="size-3" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {mission.status === "failed" ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t("multiAgents.mission.planUnreadable")}
        </p>
      ) : null}
      {mission.status === "paused" ? (
        <p className="mt-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          {t("multiAgents.mission.pausedOn", { step: mission.currentStep + 1 })}
        </p>
      ) : null}

      {done ? (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-foreground-secondary)]">
          {mission.startedAt !== null && mission.finishedAt !== null ? (
            <span>{formatMissionDuration(t, mission.finishedAt - mission.startedAt)}</span>
          ) : null}
          <span>{t("multiAgents.mission.statsFiles", { count: mission.stats.files.length })}</span>
          <span>{t("multiAgents.mission.statsCommands", { count: mission.stats.commands })}</span>
          <span>{t("multiAgents.mission.statsReviews", { count: mission.stats.reviews })}</span>
        </p>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        {mission.status === "ready" ? (
          <>
            <Button
              size="sm"
              disabled={busy || mission.steps.length === 0}
              onClick={() => void start()}
            >
              {t("multiAgents.mission.start")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => api().missionStop(ref))}
            >
              {t("multiAgents.mission.cancel")}
            </Button>
          </>
        ) : null}
        {mission.status === "running" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void act(() => api().missionStop(ref))}
          >
            {t("multiAgents.mission.stop")}
          </Button>
        ) : null}
        {mission.status === "paused" ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => void start()}>
              {t("multiAgents.mission.retry")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void start(true)}>
              {t("multiAgents.mission.skip")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => api().missionStop(ref))}
            >
              {t("multiAgents.mission.stop")}
            </Button>
          </>
        ) : null}
        {mission.status === "failed" ? (
          <Button size="sm" disabled={busy} onClick={() => void planAgain()}>
            {t("multiAgents.mission.planAgain")}
          </Button>
        ) : null}
        {done ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyToClipboard(missionSummaryText(t, mission, group), undefined)}
          >
            {copied ? (
              <CheckIcon className="size-3.5 animate-[group-pop_360ms_ease-out_1] text-emerald-500 motion-reduce:animate-none" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
            {copied ? t("multiAgents.mission.copied") : t("multiAgents.mission.copySummary")}
          </Button>
        ) : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </footer>
    </section>
  );
}

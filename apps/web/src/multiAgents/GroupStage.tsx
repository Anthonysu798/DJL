// FILE: GroupStage.tsx
// Purpose: Who is in a group and what each one is doing, kept small: the live avatars in the
//          chat header (a ring pulses on whoever is working), the running mission's pill, and
//          the one-line "Codex · Reading page.tsx · from Claude" label of a working member.
// Layer: UI component

import type { Group, GroupMember, GroupMemberActivity, GroupMission } from "@djl/contracts";
import { useTranslation } from "react-i18next";

import { FlagIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { GroupAgentAvatar } from "./GroupAgentAvatar";
import { missionProgress } from "./groupChat.logic";

type T = ReturnType<typeof useTranslation<"shell">>["t"];

export function activityLabel(t: T, activity: GroupMemberActivity | undefined): string {
  if (!activity) return t("multiAgents.stage.ready");
  const detail = activity.detail?.trim();
  if (
    detail &&
    (activity.kind === "reading" || activity.kind === "editing" || activity.kind === "running")
  )
    return t(`multiAgents.stage.with.${activity.kind}`, { detail });
  return t(`multiAgents.stage.kind.${activity.kind}`);
}

/** The group's members as live avatars: a ring pulses on each one that is working. */
export function GroupStage(props: {
  group: Group;
  activities: Readonly<Record<string, GroupMemberActivity>>;
  busy: ReadonlySet<string>;
}) {
  const { t } = useTranslation("shell");
  return (
    <span data-testid="group-stage" className="flex shrink-0 items-center gap-1.5">
      {props.group.members.map((member) => {
        const active = props.busy.has(member.id);
        const label = active
          ? activityLabel(t, props.activities[member.id])
          : member.muted
            ? t("multiAgents.stage.muted")
            : t("multiAgents.stage.ready");
        return (
          <span
            key={member.id}
            role="img"
            data-testid={`group-stage-${member.handle}`}
            data-active={active}
            aria-label={`${member.handle}: ${label}`}
            title={`${member.handle}: ${label}`}
            className={cn(
              "relative flex shrink-0 transition-opacity duration-300 ease-out",
              member.muted && !active && "opacity-40",
            )}
          >
            <GroupAgentAvatar provider={member.provider} size="sm" />
            {active ? (
              <span
                aria-hidden
                className="absolute -inset-[3px] animate-pulse rounded-[9px] border border-emerald-500/60 motion-reduce:animate-none"
              />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** "Mission 1/4" for the header, while a mission runs. */
export function GroupMissionPill(props: { mission: GroupMission }) {
  const { t } = useTranslation("shell");
  const progress = missionProgress(props.mission);
  return (
    <span
      data-testid="group-stage-mission"
      className="glass-control flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] text-[var(--color-text-foreground-secondary)]"
    >
      <FlagIcon className="size-3" />
      <span className="tabular-nums">
        {t("multiAgents.stage.mission", { done: progress.done, total: progress.total })}
      </span>
    </span>
  );
}

/** What a working member is doing, in one line, and who handed it the work. */
export function GroupWorkingLabel(props: {
  group: Group;
  member: GroupMember;
  activity: GroupMemberActivity | undefined;
  waiting: boolean;
}) {
  const { t } = useTranslation("shell");
  const { member, activity } = props;
  const from = props.group.members.find((entry) => entry.id === activity?.from)?.handle;
  const label = props.waiting
    ? t("multiAgents.chat.waiting", { name: member.handle })
    : !activity || activity.kind === "thinking"
      ? t("multiAgents.chat.working", { name: member.handle })
      : `${member.handle} · ${activityLabel(t, activity)}`;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
      <span key={label} className="shimmer truncate text-[var(--color-text-foreground-secondary)]">
        {label}
      </span>
      {from && !props.waiting ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("multiAgents.stage.from", { name: from })}
        </span>
      ) : null}
    </span>
  );
}

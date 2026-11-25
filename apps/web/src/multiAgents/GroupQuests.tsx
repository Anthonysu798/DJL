// FILE: GroupQuests.tsx
// Purpose: Starter quests at the top of a new group: say hi to everyone, ask one agent, react to
//          an answer, run a mission. Each has a Try it button; the card can be hidden and goes
//          away by itself once all four are done.
// Layer: UI component

import type { Group } from "@djl/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { QUEST_ORDER, type QuestId } from "./groupChat.logic";

const hiddenKey = (groupId: string) => `djl.multiAgents.questsHidden.${groupId}`;
const readHidden = (groupId: string) => {
  try {
    return window.localStorage.getItem(hiddenKey(groupId)) === "1";
  } catch {
    return false;
  }
};
const saveHidden = (groupId: string) => {
  try {
    window.localStorage.setItem(hiddenKey(groupId), "1");
  } catch {
    // Storage can be unavailable; the card then shows again next time.
  }
};
// How long the finished card stays to celebrate before it hides itself.
const ALL_DONE_LINGER_MS = 4000;

export function GroupQuests(props: {
  group: Group;
  progress: Record<QuestId, boolean>;
  onTry: (quest: QuestId) => void;
}) {
  const { t } = useTranslation("shell");
  const { group, progress } = props;
  const [hidden, setHidden] = useState(() => readHidden(group.id));
  const done = QUEST_ORDER.filter((quest) => progress[quest]).length;
  const allDone = done === QUEST_ORDER.length;

  useEffect(() => setHidden(readHidden(group.id)), [group.id]);
  useEffect(() => {
    if (!allDone || hidden) return;
    const timer = window.setTimeout(() => {
      saveHidden(group.id);
      setHidden(true);
    }, ALL_DONE_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [allDone, hidden, group.id]);

  if (hidden) return null;
  return (
    <section
      data-testid="group-quests"
      aria-label={t("multiAgents.quests.title")}
      className={cn(
        "mt-3 mb-1 animate-in rounded-2xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] px-4 py-3 duration-300 fade-in slide-in-from-top-1 motion-reduce:animate-none",
        allDone && "animate-[group-mission-complete_900ms_ease-out_1]",
      )}
    >
      <div className="flex items-center gap-3">
        <h3 className="text-[13px] font-medium">
          {allDone ? t("multiAgents.quests.allDone") : t("multiAgents.quests.title")}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("multiAgents.quests.progress", { done, total: QUEST_ORDER.length })}
        </span>
        <span
          aria-hidden
          className="h-1 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text-foreground)_10%,transparent)]"
        >
          <span
            className="block h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
            style={{ width: `${(done / QUEST_ORDER.length) * 100}%` }}
          />
        </span>
        <button
          type="button"
          aria-label={t("multiAgents.quests.hide")}
          title={t("multiAgents.quests.hide")}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => {
            saveHidden(group.id);
            setHidden(true);
          }}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <ol className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        {QUEST_ORDER.map((quest) => {
          const finished = progress[quest];
          return (
            <li
              key={quest}
              data-testid={`group-quest-${quest}`}
              data-done={finished}
              className="flex items-center gap-2.5 rounded-xl px-1 py-1"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,transform] duration-300 ease-out",
                  finished
                    ? "scale-100 border-transparent bg-emerald-500 text-white"
                    : "border-[color:var(--color-border)]",
                )}
              >
                {finished ? <CheckIcon className="size-3" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className={cn("text-[13px]", finished && "text-muted-foreground")}>
                  {t(`multiAgents.quests.${quest}.title`)}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {t(`multiAgents.quests.${quest}.hint`)}
                </span>
              </span>
              {finished ? null : (
                <button
                  type="button"
                  className="h-6 shrink-0 rounded-md border border-[color:var(--color-border-light)] px-2 text-xs text-[var(--color-text-foreground-secondary)] transition-[border-color,background-color,transform] duration-150 ease-out hover:border-[color:var(--color-border)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
                  onClick={() => props.onTry(quest)}
                >
                  {t("multiAgents.quests.tryIt")}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

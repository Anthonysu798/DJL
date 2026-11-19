// FILE: GroupEmptyChat.tsx
// Purpose: What a group chat shows before its first message: who is in it, how to talk to
//          them, and a few first messages to try (each one fills the composer, it does not send).
// Layer: UI component

import type { Group } from "@synara/contracts";
import { useTranslation } from "react-i18next";

import { ArrowUpRightIcon } from "~/lib/icons";

import { GroupAgentAvatar } from "./GroupAgentAvatar";

export function GroupEmptyChat(props: { group: Group; onPick: (text: string) => void }) {
  const { t } = useTranslation("shell");
  const members = props.group.members.toSorted((left, right) => left.position - right.position);
  const [first, second] = members;
  if (!first) return null;

  const starters = [
    {
      title: t("multiAgents.chat.starterMeet"),
      prompt: t("multiAgents.chat.starterMeetPrompt"),
    },
    {
      title: t("multiAgents.chat.starterOne"),
      prompt: t("multiAgents.chat.starterOnePrompt", { name: first.handle }),
    },
    ...(second
      ? [
          {
            title: t("multiAgents.chat.starterReview"),
            prompt: t("multiAgents.chat.starterReviewPrompt", {
              first: first.handle,
              second: second.handle,
            }),
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-full flex-col justify-end pt-10 pb-2" data-testid="group-empty-chat">
      <div className="flex -space-x-1.5">
        {members.slice(0, 6).map((member) => (
          <GroupAgentAvatar
            key={member.id}
            provider={member.provider}
            className="size-9 rounded-[10px] ring-[3px] ring-background [&_svg]:size-[18px]"
          />
        ))}
      </div>
      <h3 className="mt-5 text-[17px] font-medium tracking-[-0.01em] text-balance">
        {t("multiAgents.chat.startTitle")}
      </h3>
      <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-pretty text-[var(--color-text-foreground-secondary)]">
        {t("multiAgents.chat.startBody")}
      </p>
      <ul className="mt-6 flex flex-col divide-y divide-[color:var(--color-border-light)] border-y border-[color:var(--color-border-light)]">
        {starters.map((starter) => (
          <li key={starter.title}>
            <button
              type="button"
              className="group/starter -mx-2 flex w-[calc(100%+1rem)] items-baseline gap-4 rounded-lg px-2 py-3 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.995]"
              onClick={() => props.onPick(starter.prompt)}
            >
              <span className="w-40 shrink-0 text-[13px] font-medium">{starter.title}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground transition-colors duration-150 group-hover/starter:text-[var(--color-text-foreground-secondary)]">
                {starter.prompt}
              </span>
              <ArrowUpRightIcon className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/starter:translate-x-0.5 group-hover/starter:opacity-100 group-focus-visible/starter:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

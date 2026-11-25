// FILE: MultiAgentsScreen.tsx
// Purpose: The Multi agents section: group list on the left, the selected group's chat in the
//          middle, its settings behind a button, and the two-step setup for new groups.
// Layer: UI screen

import { type Group, type GroupId } from "@djl/contracts";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { AdjustmentsIcon, LinkIcon, PlusIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { GroupAvatarStack } from "./GroupAgentAvatar";
import { canLendAgents, useAgentLinks } from "./agentLinks";
import { GroupChatView } from "./GroupChatView";
import { JoinGroupDialog, LentAgentsList } from "./GroupLending";
import { GroupMembersPanel } from "./GroupMembersPanel";
import { GroupSetupDialog } from "./GroupSetupDialog";
import { useGroupEvents, useGroupStore } from "./groupStore";

export function MultiAgentsScreen(props: {
  selectedGroupId: GroupId | undefined;
  onSelectGroup: (groupId: GroupId | undefined) => void;
  renderChat?: (group: Group, headerActions: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation("shell");
  useGroupEvents();
  const loaded = useGroupStore((state) => state.loaded);
  const groupsById = useGroupStore((state) => state.groups);
  const groups = Object.values(groupsById).toSorted(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const selected =
    (props.selectedGroupId ? groupsById[props.selectedGroupId] : undefined) ?? groups[0];
  const [setupOpen, setSetupOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const lent = useAgentLinks();
  const lending = canLendAgents();
  const [notice, setNotice] = useState<string | null>(null);
  const showSetup = setupOpen || (loaded && groups.length === 0 && notice === null);

  const iconButtonClass =
    "flex size-7 items-center justify-center rounded-md text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94]";
  const headerActions = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={t("multiAgents.chat.members")}
            aria-pressed={membersOpen}
            className={cn(
              iconButtonClass,
              membersOpen && "bg-[var(--color-background-button-secondary-hover)] text-foreground",
            )}
            onClick={() => setMembersOpen((open) => !open)}
          />
        }
      >
        <AdjustmentsIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{t("multiAgents.members.title")}</TooltipPopup>
    </Tooltip>
  );

  return (
    <div className="flex h-full min-h-0 w-full bg-background" data-testid="multi-agents-screen">
      <nav className="flex w-60 shrink-0 flex-col border-r border-[color:var(--color-border-light)]">
        <div className="flex h-12 items-center justify-between pr-2 pl-4">
          <h1 className="text-[13px] font-medium">{t("multiAgents.title")}</h1>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t("multiAgents.newGroup")}
                  className={iconButtonClass}
                  onClick={() => setSetupOpen(true)}
                />
              }
            >
              <PlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{t("multiAgents.newGroup")}</TooltipPopup>
          </Tooltip>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
          {groups.map((group) => {
            const active = selected?.id === group.id;
            return (
              <li key={group.id}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "group/item flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.99]",
                    active && "bg-[var(--color-background-button-secondary-hover)] text-foreground",
                  )}
                  onClick={() => {
                    setNotice(null);
                    props.onSelectGroup(group.id);
                  }}
                >
                  <GroupAvatarStack members={group.members} />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span
                    className={cn(
                      "text-[11px] text-muted-foreground/60 tabular-nums transition-opacity duration-150 group-hover/item:opacity-100",
                      !active && "opacity-0",
                    )}
                  >
                    {group.members.length}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <LentAgentsList links={lent} />
        {lending ? (
          <div className="border-t border-[color:var(--color-border-light)] p-2">
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.99]"
              onClick={() => setJoinOpen(true)}
            >
              <LinkIcon className="size-4" />
              {t("multiAgents.lend.join")}
            </button>
          </div>
        ) : null}
      </nav>
      <main className="relative flex min-h-0 min-w-0 flex-1">
        {selected ? (
          <>
            {props.renderChat ? (
              props.renderChat(selected, headerActions)
            ) : (
              <GroupChatView group={selected} headerActions={headerActions} />
            )}
            {membersOpen ? (
              <GroupMembersPanel
                group={selected}
                onClose={() => setMembersOpen(false)}
                onDeleted={(folder) => {
                  setMembersOpen(false);
                  setNotice(t("multiAgents.members.deleted", { folder }));
                  props.onSelectGroup(undefined);
                }}
              />
            ) : null}
          </>
        ) : (
          <div className="m-auto flex max-w-xs flex-col items-start gap-1 p-6">
            <h2 className="text-[15px] font-medium">{t("multiAgents.emptyTitle")}</h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {notice ?? t("multiAgents.emptyBody")}
            </p>
            <Button size="sm" className="mt-3" onClick={() => setSetupOpen(true)}>
              <PlusIcon className="size-3.5" />
              {t("multiAgents.newGroup")}
            </Button>
          </div>
        )}
      </main>
      <JoinGroupDialog open={joinOpen} onOpenChange={setJoinOpen} />
      <GroupSetupDialog
        open={showSetup && !joinOpen}
        onOpenChange={(open) => {
          setSetupOpen(open);
          if (!open && groups.length === 0) setNotice(t("multiAgents.emptyBody"));
        }}
        onCreated={(group) => {
          setNotice(null);
          props.onSelectGroup(group.id);
        }}
      />
    </div>
  );
}

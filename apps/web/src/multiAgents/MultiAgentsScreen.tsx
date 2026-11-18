// FILE: MultiAgentsScreen.tsx
// Purpose: The Multi agents section: group list on the left, the selected group's chat in the
//          middle, its settings behind a button, and the two-step setup for new groups.
// Layer: UI screen

import { type Group, type GroupId } from "@synara/contracts";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ProviderIcon } from "~/components/ProviderIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { GroupChatView } from "./GroupChatView";
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
  const [notice, setNotice] = useState<string | null>(null);
  const showSetup = setupOpen || (loaded && groups.length === 0 && notice === null);

  const headerActions = (
    <Button size="xs" variant="outline" onClick={() => setMembersOpen((open) => !open)}>
      {t("multiAgents.chat.members")}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 w-full bg-background" data-testid="multi-agents-screen">
      <nav className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex h-12 items-center justify-between px-3">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            {t("multiAgents.title")}
            <Badge variant="outline">{t("multiAgents.beta")}</Badge>
          </h1>
          <Button size="xs" variant="ghost" onClick={() => setSetupOpen(true)}>
            {t("multiAgents.newGroup")}
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {groups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted",
                  selected?.id === group.id && "bg-muted",
                )}
                onClick={() => {
                  setNotice(null);
                  props.onSelectGroup(group.id);
                }}
              >
                <span className="flex -space-x-1">
                  {group.members.slice(0, 3).map((member) => (
                    <ProviderIcon key={member.id} provider={member.provider} className="size-4" />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="text-xs text-muted-foreground">{group.members.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex min-h-0 min-w-0 flex-1">
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
                onDeleted={(folder) => {
                  setMembersOpen(false);
                  setNotice(t("multiAgents.members.deleted", { folder }));
                  props.onSelectGroup(undefined);
                }}
              />
            ) : null}
          </>
        ) : (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center">
            <h2 className="text-base font-semibold">{t("multiAgents.emptyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{notice ?? t("multiAgents.emptyBody")}</p>
            <Button size="sm" onClick={() => setSetupOpen(true)}>
              {t("multiAgents.newGroup")}
            </Button>
          </div>
        )}
      </main>
      <GroupSetupDialog
        open={showSetup}
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

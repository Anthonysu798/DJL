// FILE: GroupMembersPanel.tsx
// Purpose: Group settings beside the chat: members (role, model, remove), add member, hop limit,
//          folder and delete.
// Layer: UI component

import {
  GROUP_ROLE_PRESETS,
  PROVIDER_DISPLAY_NAMES,
  type Group,
  type GroupMember,
} from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { PlusIcon, Trash2, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { GroupAgentAvatar } from "./GroupAgentAvatar";

import { isLargeGroup } from "./groupChat.logic";
import { isPresetRole } from "./groupLabels";
import { useGroupStore } from "./groupStore";
import { memberChoices } from "./GroupSetupDialog.logic";

const CUSTOM = "__custom";
const NO_ROLE = "__none";
const FIELD_CLASS = "flex flex-col gap-1.5 text-xs text-muted-foreground";
const ICON_BUTTON_CLASS =
  "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,opacity,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94]";

function MemberRow(props: { group: Group; member: GroupMember; onError: () => void }) {
  const { t } = useTranslation("shell");
  const { group, member } = props;
  const state = useGroupStore((store) => store.memberStates[member.id] ?? "idle");
  const custom = member.role !== null && !isPresetRole(member.role);
  const [customRole, setCustomRole] = useState(custom ? (member.role ?? "") : "");
  const [editingCustom, setEditingCustom] = useState(custom);
  const [model, setModel] = useState(member.model ?? "");
  const roleOptions = [
    { value: NO_ROLE, label: t("multiAgents.members.roleNone") },
    ...GROUP_ROLE_PRESETS.map((role) => ({
      value: role as string,
      label: t(`multiAgents.roles.${role}`),
    })),
    { value: CUSTOM, label: t("multiAgents.members.roleCustom") },
  ];
  const roleValue = editingCustom ? CUSTOM : (member.role ?? NO_ROLE);
  const update = (patch: { role?: string | null; model?: string | null }) =>
    ensureNativeApi()
      .groups.updateMember({ groupId: group.id, memberId: member.id, ...patch })
      .catch(props.onError);

  return (
    <li className="group/member flex flex-col gap-3 py-4 first:pt-0">
      <div className="flex items-center gap-2.5">
        <GroupAgentAvatar provider={member.provider} size="sm" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{member.handle}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              state === "working"
                ? "animate-pulse bg-emerald-500"
                : state === "waiting"
                  ? "bg-amber-500"
                  : state === "failed"
                    ? "bg-destructive"
                    : "bg-muted-foreground/30",
            )}
          />
          {t(`multiAgents.members.state.${state}`)}
        </span>
        <button
          type="button"
          aria-label={`${t("multiAgents.members.remove")} ${member.handle}`}
          title={t("multiAgents.members.remove")}
          className={cn(
            ICON_BUTTON_CLASS,
            "opacity-0 group-hover/member:opacity-100 hover:text-destructive",
          )}
          onClick={() =>
            void ensureNativeApi()
              .groups.removeMember({ groupId: group.id, memberId: member.id })
              .catch(props.onError)
          }
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className={FIELD_CLASS}>
        {t("multiAgents.members.role")}
        <Select
          value={roleValue}
          onValueChange={(value) => {
            if (value === null) return;
            if (value === CUSTOM) {
              setEditingCustom(true);
              return;
            }
            setEditingCustom(false);
            void update({ role: value === NO_ROLE ? null : value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full rounded-lg"
            aria-label={`${t("multiAgents.members.role")}: ${member.handle}`}
          >
            <SelectValue>
              {roleOptions.find((option) => option.value === roleValue)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {roleOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {editingCustom ? (
        <Input
          value={customRole}
          placeholder={t("multiAgents.members.customRolePlaceholder")}
          onChange={(event) => setCustomRole(event.target.value)}
          onBlur={() => void update({ role: customRole.trim() || null })}
        />
      ) : null}
      <label className={FIELD_CLASS}>
        {t("multiAgents.members.model")}
        <Input
          value={model}
          placeholder={t("multiAgents.members.modelPlaceholder")}
          onChange={(event) => setModel(event.target.value)}
          onBlur={() => void update({ model: model.trim() || null })}
        />
      </label>
    </li>
  );
}

export function GroupMembersPanel(props: {
  group: Group;
  onClose: () => void;
  onDeleted: (folder: string) => void;
}) {
  const { t } = useTranslation("shell");
  const { group } = props;
  const [error, setError] = useState<string | null>(null);
  const [hopLimit, setHopLimit] = useState(String(group.hopLimit));
  const accountsQuery = useQuery({
    queryKey: ["harness-accounts"],
    queryFn: () => ensureNativeApi().harnesses.listAccounts(),
  });
  const addable = memberChoices(accountsQuery.data?.accounts ?? [], {
    checkFailed: accountsQuery.isError,
  }).filter((choice) => choice.ready !== false);
  const onError = () => setError(t("multiAgents.errors.updateFailed"));
  const api = () => ensureNativeApi();

  const chooseFolder = async () => {
    const folder = await api().dialogs.pickFolder();
    if (folder) await api().groups.update({ groupId: group.id, folder }).catch(onError);
  };
  const remove = async () => {
    if (!window.confirm(t("multiAgents.members.deleteConfirm", { folder: group.folder }))) return;
    try {
      const result = await api().groups.delete({ groupId: group.id });
      props.onDeleted(result.folder);
    } catch {
      onError();
    }
  };

  return (
    <aside className="flex w-80 shrink-0 animate-in flex-col overflow-y-auto border-l border-[color:var(--color-border-light)] duration-200 fade-in slide-in-from-right-2 motion-reduce:animate-none">
      <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
        <h3 className="text-[13px] font-medium">{t("multiAgents.members.title")}</h3>
        <button
          type="button"
          aria-label={t("multiAgents.members.close")}
          className={cn(ICON_BUTTON_CLASS, "size-7")}
          onClick={props.onClose}
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
        {isLargeGroup(group) ? (
          <p className="rounded-lg bg-[var(--color-background-elevated-secondary)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-foreground-secondary)]">
            {t("multiAgents.members.largeGroup")}
          </p>
        ) : null}
        <ul className="flex flex-col divide-y divide-[color:var(--color-border-light)]">
          {group.members.map((member) => (
            <MemberRow key={member.id} group={group} member={member} onError={onError} />
          ))}
        </ul>
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                disabled={addable.length === 0}
                className="-mt-2 flex h-8 items-center gap-2 self-start rounded-lg px-2 text-[13px] text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
              />
            }
          >
            <PlusIcon className="size-3.5" />
            {t("multiAgents.members.add")}
          </MenuTrigger>
          <MenuPopup align="start">
            {addable.map((choice) => (
              <MenuItem
                key={choice.provider}
                onClick={() =>
                  void api()
                    .groups.addMember({ groupId: group.id, provider: choice.provider })
                    .catch(onError)
                }
              >
                <GroupAgentAvatar provider={choice.provider} size="xs" />
                {PROVIDER_DISPLAY_NAMES[choice.provider]}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
        <label className={FIELD_CLASS}>
          {t("multiAgents.members.hopLimit")}
          <Input
            type="number"
            min={1}
            max={100}
            value={hopLimit}
            onChange={(event) => setHopLimit(event.target.value)}
            onBlur={() => {
              const value = Number(hopLimit);
              if (Number.isInteger(value) && value >= 1 && value <= 100)
                void api().groups.update({ groupId: group.id, hopLimit: value }).catch(onError);
              else setHopLimit(String(group.hopLimit));
            }}
          />
        </label>
        <div className={FIELD_CLASS}>
          {t("multiAgents.members.folder")}
          <p className="font-mono text-[11px] leading-relaxed break-all text-foreground">
            {group.folder}
          </p>
          <p className="leading-relaxed">
            {group.folderIsAuto
              ? t("multiAgents.members.folderAuto")
              : t("multiAgents.members.folderWarning")}
          </p>
          <Button
            size="xs"
            variant="outline"
            className="self-start"
            onClick={() => void chooseFolder()}
          >
            {t("multiAgents.members.chooseFolder")}
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <button
          type="button"
          className="mt-auto flex h-8 items-center gap-2 self-start rounded-lg px-2 text-[13px] text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
          onClick={() => void remove()}
        >
          <Trash2 className="size-3.5" />
          {t("multiAgents.members.deleteGroup")}
        </button>
      </div>
    </aside>
  );
}

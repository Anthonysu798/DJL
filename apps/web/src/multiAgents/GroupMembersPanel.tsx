// FILE: GroupMembersPanel.tsx
// Purpose: Group settings beside the chat: members (role, model, remove), add member, hop limit,
//          folder and delete.
// Layer: UI component

import {
  GROUP_ROLE_PRESETS,
  PROVIDER_DISPLAY_NAMES,
  type Group,
  type GroupMember,
  type GroupMemberProvider,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ProviderIcon } from "~/components/ProviderIcon";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ensureNativeApi } from "~/nativeApi";

import { isLargeGroup } from "./groupChat.logic";
import { isPresetRole } from "./groupLabels";
import { useGroupStore } from "./groupStore";
import { memberChoices } from "./GroupSetupDialog.logic";

const CUSTOM = "__custom";

function MemberRow(props: { group: Group; member: GroupMember; onError: () => void }) {
  const { t } = useTranslation("shell");
  const { group, member } = props;
  const state = useGroupStore((store) => store.memberStates[member.id] ?? "idle");
  const custom = member.role !== null && !isPresetRole(member.role);
  const [customRole, setCustomRole] = useState(custom ? (member.role ?? "") : "");
  const [editingCustom, setEditingCustom] = useState(custom);
  const [model, setModel] = useState(member.model ?? "");
  const update = (patch: { role?: string | null; model?: string | null }) =>
    ensureNativeApi()
      .groups.updateMember({ groupId: group.id, memberId: member.id, ...patch })
      .catch(props.onError);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <ProviderIcon provider={member.provider} className="size-5" />
        <span className="flex-1 truncate text-sm font-medium">{member.handle}</span>
        <span className="text-xs text-muted-foreground">
          {t(`multiAgents.members.state.${state}`)}
        </span>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("multiAgents.members.role")}
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          value={editingCustom ? CUSTOM : (member.role ?? "")}
          onChange={(event) => {
            const value = event.target.value;
            if (value === CUSTOM) {
              setEditingCustom(true);
              return;
            }
            setEditingCustom(false);
            void update({ role: value || null });
          }}
        >
          <option value="">{t("multiAgents.members.roleNone")}</option>
          {GROUP_ROLE_PRESETS.map((role) => (
            <option key={role} value={role}>
              {t(`multiAgents.roles.${role}`)}
            </option>
          ))}
          <option value={CUSTOM}>{t("multiAgents.members.roleCustom")}</option>
        </select>
      </label>
      {editingCustom ? (
        <Input
          value={customRole}
          placeholder={t("multiAgents.members.customRolePlaceholder")}
          onChange={(event) => setCustomRole(event.target.value)}
          onBlur={() => void update({ role: customRole.trim() || null })}
        />
      ) : null}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("multiAgents.members.model")}
        <Input
          value={model}
          placeholder={t("multiAgents.members.modelPlaceholder")}
          onChange={(event) => setModel(event.target.value)}
          onBlur={() => void update({ model: model.trim() || null })}
        />
      </label>
      <Button
        size="xs"
        variant="ghost"
        className="self-end"
        onClick={() =>
          void ensureNativeApi()
            .groups.removeMember({ groupId: group.id, memberId: member.id })
            .catch(props.onError)
        }
      >
        {t("multiAgents.members.remove")}
      </Button>
    </li>
  );
}

export function GroupMembersPanel(props: { group: Group; onDeleted: (folder: string) => void }) {
  const { t } = useTranslation("shell");
  const { group } = props;
  const [error, setError] = useState<string | null>(null);
  const [hopLimit, setHopLimit] = useState(String(group.hopLimit));
  const accountsQuery = useQuery({
    queryKey: ["harness-accounts"],
    queryFn: () => ensureNativeApi().harnesses.listAccounts(),
  });
  const addable = memberChoices(accountsQuery.data?.accounts ?? []).filter(
    (choice) => choice.ready,
  );
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
    <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border p-4">
      <h3 className="text-sm font-semibold">{t("multiAgents.members.title")}</h3>
      {isLargeGroup(group) ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs">
          {t("multiAgents.members.largeGroup")}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {group.members.map((member) => (
          <MemberRow key={member.id} group={group} member={member} onError={onError} />
        ))}
      </ul>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("multiAgents.members.add")}
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          value=""
          onChange={(event) => {
            const provider = event.target.value as GroupMemberProvider;
            if (provider)
              void api().groups.addMember({ groupId: group.id, provider }).catch(onError);
          }}
        >
          <option value="">{t("multiAgents.members.add")}</option>
          {addable.map((choice) => (
            <option key={choice.provider} value={choice.provider}>
              {PROVIDER_DISPLAY_NAMES[choice.provider]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
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
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("multiAgents.members.folder")}
        <p className="break-all text-foreground">{group.folder}</p>
        <p>
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
      <Button
        size="sm"
        variant="destructive-outline"
        className="mt-auto"
        onClick={() => void remove()}
      >
        {t("multiAgents.members.deleteGroup")}
      </Button>
    </aside>
  );
}

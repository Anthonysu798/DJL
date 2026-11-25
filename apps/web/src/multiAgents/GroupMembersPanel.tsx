// FILE: GroupMembersPanel.tsx
// Purpose: Group settings as one small glass panel floating over the chat: a plain list of
//          label + picker rows. Each member has a model picker and a "…" menu (role, mute,
//          context used, Start fresh, Remove); two more rows set who gets messages without @ and
//          who checks changes. The brief, hand-off limit, folder and Delete sit behind
//          "More settings".
// Layer: UI component

import {
  GROUP_BRIEF_MAX_LENGTH,
  GROUP_ROLE_PRESETS,
  PROVIDER_DISPLAY_NAMES,
  type Group,
  type GroupDefaultRecipient,
  type GroupMember,
  type GroupMemberId,
} from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { Textarea } from "~/components/ui/textarea";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { ChevronDownIcon, EllipsisIcon, PlusIcon, RotateCcwIcon, Trash2, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { GroupAgentAvatar } from "./GroupAgentAvatar";

import { contextLevel, contextShare, isLargeGroup } from "./groupChat.logic";
import { GroupGuestsSection } from "./GroupGuestsSection";
import { isPresetRole } from "./groupLabels";
import { GROUP_MENU_CLASS, GroupChoiceMenu, GroupMenuHeader } from "./GroupMenu";
import { useGroupStore } from "./groupStore";
import { memberChoices } from "./GroupSetupDialog.logic";

const CUSTOM = "__custom";
const NO_ROLE = "__none";
const DEFAULT_MODEL = "__default";
const REVIEW_OFF = "__off";
const FIELD_CLASS = "flex flex-col gap-1.5 text-xs text-muted-foreground";
const LINE_CLASS =
  "flex min-h-9 items-center justify-between gap-3 text-xs text-[var(--color-text-foreground-secondary)]";
const ICON_BUTTON_CLASS =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--glass-control-fill-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94] data-popup-open:bg-[var(--glass-control-fill-hover)] data-popup-open:text-foreground";
const TEXT_BUTTON_CLASS =
  "flex h-7 items-center gap-2 self-start rounded-full px-2 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--glass-control-fill-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

type ModelOption = { slug: string; name: string };

/** One member: icon, name, its model as a picker, and a "…" menu for everything else. */
function MemberRow(props: {
  group: Group;
  member: GroupMember;
  models: readonly ModelOption[];
  onError: () => void;
}) {
  const { t, i18n } = useTranslation("shell");
  const { group, member } = props;
  const state = useGroupStore((store) => store.memberStates[member.id] ?? "idle");
  const custom = member.role !== null && !isPresetRole(member.role);
  const [customRole, setCustomRole] = useState(custom ? (member.role ?? "") : "");
  const [editingCustom, setEditingCustom] = useState(custom);
  const roleOptions = [
    { value: NO_ROLE, label: t("multiAgents.members.roleNone") },
    ...GROUP_ROLE_PRESETS.map((role) => ({
      value: role as string,
      label: t(`multiAgents.roles.${role}`),
    })),
    { value: CUSTOM, label: t("multiAgents.members.roleCustom") },
  ];
  const roleValue = editingCustom ? CUSTOM : (member.role ?? NO_ROLE);
  const update = (patch: { role?: string | null; model?: string | null; muted?: boolean }) =>
    ensureNativeApi()
      .groups.updateMember({ groupId: group.id, memberId: member.id, ...patch })
      .catch(props.onError);
  const share = contextShare(member.contextUsage);
  const level = contextLevel(share);
  const stateLabel = t(`multiAgents.members.state.${state}`);
  const contextText =
    member.contextUsage === null
      ? t("multiAgents.members.contextUnknown")
      : share === null
        ? t("multiAgents.members.contextTokens", {
            tokens: member.contextUsage.usedTokens.toLocaleString(),
          })
        : new Intl.NumberFormat(i18n.language, { style: "percent" }).format(share);
  // A model saved earlier that the agent no longer lists still shows, so it can be changed.
  const models =
    member.model && !props.models.some((option) => option.slug === member.model)
      ? [{ slug: member.model, name: member.model }, ...props.models]
      : props.models;
  const avatar = <GroupAgentAvatar provider={member.provider} size="md" />;

  return (
    <li className="flex flex-col">
      <div className="flex h-11 items-center gap-2">
        <span className="relative flex shrink-0" title={stateLabel}>
          <GroupAgentAvatar provider={member.provider} size="sm" />
          {state !== "idle" ? (
            <span
              role="img"
              aria-label={stateLabel}
              className={cn(
                "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-[var(--popover)]",
                state === "working"
                  ? "animate-pulse bg-emerald-500 motion-reduce:animate-none"
                  : state === "waiting"
                    ? "bg-amber-500"
                    : "bg-destructive",
              )}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span
            className={cn(
              "truncate text-[13px] font-medium",
              member.muted && "text-muted-foreground",
            )}
          >
            {member.handle}
          </span>
          {member.guestId ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("multiAgents.guests.tag")}
            </span>
          ) : null}
          {member.muted ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("multiAgents.stage.muted")}
            </span>
          ) : null}
        </span>
        {member.guestId ? (
          // A visiting agent runs on its owner's computer; its model is theirs to choose.
          <span
            data-testid={`group-member-visiting-${member.handle}`}
            title={t("multiAgents.guests.visitingHint")}
            className="max-w-40 shrink truncate text-xs text-muted-foreground"
          >
            {member.model ?? t("multiAgents.members.modelPlaceholder")}
          </span>
        ) : (
          <GroupChoiceMenu
            label={`${t("multiAgents.members.model")}: ${member.handle}`}
            testId={`group-member-model-${member.handle}`}
            value={member.model ?? DEFAULT_MODEL}
            choices={[
              { value: DEFAULT_MODEL, label: t("multiAgents.members.modelPlaceholder") },
              ...models.map((option, index) => ({
                value: option.slug,
                label: option.name,
                divided: index === 0,
              })),
            ]}
            header={
              <GroupMenuHeader
                icon={avatar}
                title={member.handle}
                subtitle={t("multiAgents.members.model")}
              />
            }
            searchPlaceholder={t("multiAgents.members.modelSearch")}
            onChange={(value) => void update({ model: value === DEFAULT_MODEL ? null : value })}
          />
        )}
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label={t("multiAgents.members.options", { name: member.handle })}
                title={t("multiAgents.members.options", { name: member.handle })}
                className={ICON_BUTTON_CLASS}
              />
            }
          >
            <EllipsisIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup
            surface="liquid"
            align="end"
            sideOffset={6}
            className={cn(GROUP_MENU_CLASS, "w-64")}
          >
            <GroupMenuHeader
              icon={avatar}
              title={member.handle}
              subtitle={
                <span
                  className={cn(
                    level === "full" && "text-destructive",
                    level === "high" && "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {t("multiAgents.members.context")} · {contextText}
                </span>
              }
            />
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>
                {t("multiAgents.members.role")}
                <span className="ml-auto max-w-28 truncate text-xs text-foreground/55">
                  {roleOptions.find((option) => option.value === roleValue)?.label}
                </span>
              </MenuSubTrigger>
              <MenuSubPopup surface="liquid" className={cn(GROUP_MENU_CLASS, "w-44")}>
                <MenuRadioGroup
                  value={roleValue}
                  onValueChange={(value) => {
                    if (value === CUSTOM) return setEditingCustom(true);
                    setEditingCustom(false);
                    void update({ role: value === NO_ROLE ? null : String(value) });
                  }}
                >
                  {roleOptions.map((option) => (
                    <MenuRadioItem key={option.value} value={option.value} closeOnClick>
                      {option.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubPopup>
            </MenuSub>
            <MenuCheckboxItem
              variant="switch"
              checked={member.muted}
              title={t("multiAgents.members.muteHint")}
              onCheckedChange={(checked) => void update({ muted: checked })}
            >
              {t("multiAgents.members.mute")}
            </MenuCheckboxItem>
            <MenuSeparator />
            {member.guestId ? null : (
              <MenuItem
                title={t("multiAgents.members.startFreshHint")}
                onClick={() =>
                  void ensureNativeApi()
                    .groups.resetMember({ groupId: group.id, memberId: member.id })
                    .catch(props.onError)
                }
              >
                <RotateCcwIcon />
                {t("multiAgents.members.startFresh")}
              </MenuItem>
            )}
            <MenuItem
              variant="destructive"
              onClick={() => {
                const groups = ensureNativeApi().groups;
                // A visiting agent leaves with its invite, so it cannot simply rejoin.
                void (
                  member.guestId
                    ? groups.removeGuest({ groupId: group.id, guestId: member.guestId })
                    : groups.removeMember({ groupId: group.id, memberId: member.id })
                ).catch(props.onError);
              }}
            >
              <Trash2 />
              {t("multiAgents.members.remove")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {editingCustom ? (
        <Input
          autoFocus={!custom}
          className="mb-2"
          value={customRole}
          aria-label={`${t("multiAgents.members.roleCustom")}: ${member.handle}`}
          placeholder={t("multiAgents.members.customRolePlaceholder")}
          onChange={(event) => setCustomRole(event.target.value)}
          onBlur={() => void update({ role: customRole.trim() || null })}
        />
      ) : null}
    </li>
  );
}

/** Who gets a message without @, and who checks changes: a label and a picker each. */
function GroupRoutingFields(props: { group: Group; onError: () => void }) {
  const { t } = useTranslation("shell");
  const { group } = props;
  const update = (patch: {
    defaultRecipient?: GroupDefaultRecipient;
    reviewerMemberId?: GroupMemberId | null;
  }) =>
    ensureNativeApi()
      .groups.update({ groupId: group.id, ...patch })
      .catch(props.onError);
  const memberChoices = (hint: "recipientLead" | "reviewBy") =>
    group.members.map((member, index) => ({
      value: member.id as string,
      label: member.handle,
      icon: <GroupAgentAvatar provider={member.provider} size="xs" />,
      hint: t(`multiAgents.members.${hint}`, { name: member.handle }),
      divided: index === 0,
    }));

  return (
    <div className="flex flex-col">
      <div className={LINE_CLASS}>
        {t("multiAgents.members.recipient")}
        <GroupChoiceMenu
          label={t("multiAgents.members.recipient")}
          value={group.defaultRecipient}
          choices={[
            {
              value: "last",
              label: t("multiAgents.members.recipientLastShort"),
              hint: t("multiAgents.members.recipientLast"),
            },
            {
              value: "all",
              label: t("multiAgents.members.recipientAllShort"),
              hint: t("multiAgents.members.recipientAll"),
            },
            ...memberChoices("recipientLead"),
          ]}
          onChange={(value) => void update({ defaultRecipient: value as GroupDefaultRecipient })}
        />
      </div>
      <div className={LINE_CLASS} title={t("multiAgents.members.reviewHint")}>
        {t("multiAgents.members.review")}
        <GroupChoiceMenu
          label={t("multiAgents.members.review")}
          value={group.reviewerMemberId ?? REVIEW_OFF}
          choices={[
            { value: REVIEW_OFF, label: t("multiAgents.members.reviewOff") },
            ...memberChoices("reviewBy"),
          ]}
          onChange={(value) =>
            void update({
              reviewerMemberId: value === REVIEW_OFF ? null : (value as GroupMemberId),
            })
          }
        />
      </div>
    </div>
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
  const [brief, setBrief] = useState(group.brief);
  const [more, setMore] = useState(group.brief.trim() !== "");
  const accountsQuery = useQuery({
    queryKey: ["harness-accounts"],
    queryFn: () => ensureNativeApi().harnesses.listAccounts(),
  });
  const addable = memberChoices(accountsQuery.data?.accounts ?? [], {
    checkFailed: accountsQuery.isError,
  }).filter((choice) => choice.ready !== false);
  const { modelOptionsByProvider } = useProviderModelCatalog({
    selectedProvider: group.members[0]?.provider ?? "codex",
    discoveryEnabled: true,
    cwd: group.folder,
  });
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
    <aside
      data-testid="group-settings"
      aria-label={t("multiAgents.members.title")}
      className="liquid-glass absolute top-14 right-3 z-20 flex max-h-[calc(100%-4.25rem)] w-[340px] animate-in flex-col rounded-[22px] duration-200 zoom-in-95 fade-in slide-in-from-top-1 motion-reduce:animate-none"
    >
      <div className="flex h-11 shrink-0 items-center justify-between pr-2.5 pl-4">
        <h3 className="text-[13px] font-medium">{t("multiAgents.members.title")}</h3>
        <button
          type="button"
          aria-label={t("multiAgents.members.close")}
          className={ICON_BUTTON_CLASS}
          onClick={props.onClose}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
        {isLargeGroup(group) ? (
          <p className="rounded-2xl bg-[var(--glass-control-fill)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-foreground-secondary)]">
            {t("multiAgents.members.largeGroup")}
          </p>
        ) : null}
        <div className="flex flex-col">
          <ul className="flex flex-col">
            {group.members.map((member) => (
              <MemberRow
                key={member.id}
                group={group}
                member={member}
                models={modelOptionsByProvider[member.provider] ?? []}
                onError={onError}
              />
            ))}
          </ul>
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  disabled={addable.length === 0}
                  className={cn(TEXT_BUTTON_CLASS, "mt-1 -ml-2 text-[13px]")}
                />
              }
            >
              <PlusIcon className="size-3.5" />
              {t("multiAgents.members.add")}
            </MenuTrigger>
            <MenuPopup
              surface="liquid"
              align="start"
              sideOffset={6}
              className={cn(GROUP_MENU_CLASS, "w-56")}
            >
              <MenuGroup>
                <MenuGroupLabel>{t("multiAgents.members.add")}</MenuGroupLabel>
                {addable.map((choice) => (
                  <MenuItem
                    key={choice.provider}
                    onClick={() =>
                      void api()
                        .groups.addMember({ groupId: group.id, provider: choice.provider })
                        .catch(onError)
                    }
                  >
                    <GroupAgentAvatar provider={choice.provider} size="sm" />
                    {PROVIDER_DISPLAY_NAMES[choice.provider]}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        </div>
        <div aria-hidden className="h-px bg-[var(--liquid-rule)]" />
        <GroupGuestsSection group={group} onError={onError} />
        <div aria-hidden className="h-px bg-[var(--liquid-rule)]" />
        <GroupRoutingFields group={group} onError={onError} />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <button
          type="button"
          aria-expanded={more}
          className={cn(TEXT_BUTTON_CLASS, "-ml-2")}
          onClick={() => setMore((value) => !value)}
        >
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform duration-200", more && "rotate-180")}
          />
          {t("multiAgents.members.more")}
        </button>
        {more ? (
          <div className="flex animate-in flex-col gap-4 duration-200 fade-in slide-in-from-top-1 motion-reduce:animate-none">
            <label className={FIELD_CLASS} title={t("multiAgents.members.briefHint")}>
              {t("multiAgents.members.brief")}
              <Textarea
                value={brief}
                maxLength={GROUP_BRIEF_MAX_LENGTH}
                rows={3}
                placeholder={t("multiAgents.members.briefPlaceholder")}
                onChange={(event) => setBrief(event.target.value)}
                onBlur={() => {
                  if (brief.trim() !== group.brief.trim())
                    void api().groups.update({ groupId: group.id, brief }).catch(onError);
                }}
              />
            </label>
            <label className={LINE_CLASS}>
              {t("multiAgents.members.hopLimit")}
              <Input
                type="number"
                min={1}
                max={100}
                className="w-16"
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
                className="self-start rounded-full"
                onClick={() => void chooseFolder()}
              >
                {t("multiAgents.members.chooseFolder")}
              </Button>
            </div>
            <button
              type="button"
              className={cn(
                TEXT_BUTTON_CLASS,
                "-ml-2 hover:bg-destructive/10 hover:text-destructive",
              )}
              onClick={() => void remove()}
            >
              <Trash2 className="size-3.5" />
              {t("multiAgents.members.deleteGroup")}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

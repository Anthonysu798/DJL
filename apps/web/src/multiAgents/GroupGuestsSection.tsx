// FILE: GroupGuestsSection.tsx
// Purpose: The People part of Group settings: invite a collaborator by name, pick what they may
//          do, hand them the invite code, see whether they are connected, and remove them.
// Layer: UI component

import {
  GROUP_GUEST_LIMIT,
  type DesktopGroupGuestLink,
  type Group,
  type GroupGuest,
  type GroupGuestRole,
} from "@djl/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { CheckIcon, CopyIcon, EllipsisIcon, PlusIcon, RefreshCwIcon, Trash2 } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { renewGroupGuestInvite, useGroupGuestLinks } from "./groupGuestSync";
import { useGroupStore } from "./groupStore";
import { GROUP_MENU_CLASS, GroupChoiceMenu, GroupMenuHeader } from "./GroupMenu";

/** What a person in the chat may do; changing between these needs no new invite. */
const PEOPLE_ROLES: readonly GroupGuestRole[] = ["chat", "viewer"];
/** What an invite can be for. "agent" brings their own agent, from their DJL desktop app. */
const INVITE_ROLES: readonly GroupGuestRole[] = ["chat", "viewer", "agent"];
const TEXT_BUTTON_CLASS =
  "flex h-7 items-center gap-2 rounded-full px-2 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--glass-control-fill-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

function Initial(props: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] font-medium uppercase",
        props.size === "md" ? "size-7 rounded-lg text-xs" : "size-6 rounded-[7px] text-[11px]",
      )}
    >
      {props.name.slice(0, 1)}
    </span>
  );
}

function GuestRow(props: {
  group: Group;
  guest: GroupGuest;
  link: DesktopGroupGuestLink | undefined;
  /** This computer can hold guest connections (the desktop app, not the browser). */
  canConnect: boolean;
  onError: () => void;
}) {
  const { t } = useTranslation("shell");
  const { group, guest, link } = props;
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({ timeout: 1600 });
  const api = () => ensureNativeApi().groups;
  // A lent agent says "still here" every half minute; a person's phone is known by its link.
  const agentOnline = useGroupStore((store) => store.guestAgents[guest.id] === true);
  const connected = guest.role === "agent" ? agentOnline : link?.status === "connected";
  // It joined before and is away now: the invite code is used up, so this is not "waiting".
  const agentAway = guest.role === "agent" && !agentOnline && link?.status === "connected";
  const expired = Boolean(link?.pairingExpiresAt && link.pairingExpiresAt <= Date.now());
  // An agent that joined and went away used its code up; "New invite code" makes another.
  const code = !connected && !expired && !agentAway ? (link?.pairingCode ?? null) : null;
  const status = !props.canConnect
    ? t("multiAgents.guests.status.desktopOnly")
    : connected
      ? t("multiAgents.guests.status.connected")
      : agentAway
        ? t("multiAgents.guests.status.agentAway")
        : link?.status === "error" || link?.status === "offline"
          ? (link.message ?? t("multiAgents.guests.status.offline"))
          : code
            ? t("multiAgents.guests.status.waiting")
            : expired
              ? t("multiAgents.guests.status.expired")
              : t("multiAgents.guests.status.starting");

  return (
    <li className="flex flex-col" data-testid={`group-guest-${guest.name}`}>
      <div className="flex h-11 items-center gap-2">
        <span className="relative flex shrink-0">
          <Initial name={guest.name} />
          {connected ? (
            <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-[var(--popover)]" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium">{guest.name}</span>
          <span className="truncate text-[11px] text-muted-foreground" role="status">
            {status}
          </span>
        </span>
        {guest.role === "agent" ? (
          // Their agent is a member of the group; what it may do is not a choice here.
          <span
            className="flex h-7 shrink-0 items-center rounded-full border border-[color:var(--color-border-light)] px-2.5 text-xs text-[var(--color-text-foreground-secondary)]"
            title={t("multiAgents.guests.roleHint.agent")}
          >
            {t("multiAgents.guests.role.agent")}
          </span>
        ) : (
          <GroupChoiceMenu
            label={t("multiAgents.guests.roleFor", { name: guest.name })}
            value={guest.role}
            choices={PEOPLE_ROLES.map((role) => ({
              value: role,
              label: t(`multiAgents.guests.role.${role}`),
              hint: t(`multiAgents.guests.roleHint.${role}`),
            }))}
            onChange={(role) =>
              void api()
                .updateGuest({ groupId: group.id, guestId: guest.id, role: role as GroupGuestRole })
                .catch(props.onError)
            }
          />
        )}
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label={t("multiAgents.members.options", { name: guest.name })}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--glass-control-fill-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94] data-popup-open:bg-[var(--glass-control-fill-hover)] data-popup-open:text-foreground"
              />
            }
          >
            <EllipsisIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup
            surface="liquid"
            align="end"
            sideOffset={6}
            className={cn(GROUP_MENU_CLASS, "w-60")}
          >
            <GroupMenuHeader
              icon={<Initial name={guest.name} size="md" />}
              title={guest.name}
              subtitle={t(`multiAgents.guests.roleHint.${guest.role}`)}
            />
            <MenuSeparator />
            {props.canConnect ? (
              <MenuItem onClick={() => void renewGroupGuestInvite(guest.id).catch(props.onError)}>
                <RefreshCwIcon />
                {t("multiAgents.guests.newCode")}
              </MenuItem>
            ) : null}
            <MenuItem
              variant="destructive"
              onClick={() =>
                void api()
                  .removeGuest({ groupId: group.id, guestId: guest.id })
                  .catch(props.onError)
              }
            >
              <Trash2 />
              {t("multiAgents.guests.remove")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {code ? (
        <div className="mb-2 flex animate-in items-center gap-2 rounded-2xl bg-[var(--glass-control-fill)] py-2 pr-2 pl-3 duration-200 fade-in slide-in-from-top-1 motion-reduce:animate-none">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] leading-snug text-muted-foreground">
              {t(
                guest.role === "agent"
                  ? "multiAgents.guests.codeHelpAgent"
                  : "multiAgents.guests.codeHelp",
                { name: guest.name },
              )}
            </span>
            <code
              data-testid="group-guest-code"
              className="block pt-0.5 font-mono text-[13px] tracking-[0.12em] text-foreground"
            >
              {code}
            </code>
          </span>
          <button
            type="button"
            className={cn(TEXT_BUTTON_CLASS, isCopied && "text-emerald-600 dark:text-emerald-400")}
            onClick={() => copyToClipboard(code, undefined)}
          >
            {isCopied ? (
              <CheckIcon className="size-3.5 animate-[group-pop_360ms_ease-out_1] motion-reduce:animate-none" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
            {isCopied ? t("multiAgents.reply.copied") : t("multiAgents.reply.copy")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function GroupGuestsSection(props: { group: Group; onError: () => void }) {
  const { t } = useTranslation("shell");
  const { group } = props;
  const links = useGroupGuestLinks();
  const guests = group.guests ?? [];
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<GroupGuestRole>("chat");
  const [error, setError] = useState<string | null>(null);
  const canConnect = Boolean(window.desktopBridge?.remote.syncGroupGuests);
  const full = guests.length >= GROUP_GUEST_LIMIT;

  const invite = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await ensureNativeApi().groups.inviteGuest({ groupId: group.id, name: trimmed, role });
      setName("");
      setInviting(false);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message ? cause.message : t("multiAgents.guests.failed"),
      );
    }
  };

  return (
    <section className="flex flex-col" aria-label={t("multiAgents.guests.title")}>
      <h4 className="flex h-7 items-center text-xs text-muted-foreground">
        {t("multiAgents.guests.title")}
      </h4>
      {guests.length > 0 ? (
        <ul className="flex flex-col">
          {guests.map((guest) => (
            <GuestRow
              key={guest.id}
              group={group}
              guest={guest}
              link={links.find((entry) => entry.guestId === guest.id)}
              canConnect={canConnect}
              onError={props.onError}
            />
          ))}
        </ul>
      ) : null}
      {inviting ? (
        <form
          className="flex animate-in flex-col gap-2 rounded-2xl bg-[var(--glass-control-fill)] p-2.5 duration-200 fade-in slide-in-from-top-1 motion-reduce:animate-none"
          onSubmit={(event) => {
            event.preventDefault();
            void invite();
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={40}
            aria-label={t("multiAgents.guests.namePlaceholder")}
            placeholder={t("multiAgents.guests.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <GroupChoiceMenu
              label={t("multiAgents.guests.roleLabel")}
              value={role}
              choices={INVITE_ROLES.map((entry) => ({
                value: entry,
                label: t(`multiAgents.guests.role.${entry}`),
                hint: t(`multiAgents.guests.roleHint.${entry}`),
              }))}
              onChange={(value) => setRole(value as GroupGuestRole)}
            />
            <span className="flex items-center gap-1">
              <button
                type="button"
                className={TEXT_BUTTON_CLASS}
                onClick={() => {
                  setInviting(false);
                  setError(null);
                }}
              >
                {t("multiAgents.guests.cancel")}
              </button>
              <button
                type="submit"
                disabled={!name.trim()}
                className={cn(TEXT_BUTTON_CLASS, "glass-control border px-3 text-foreground")}
              >
                {t("multiAgents.guests.invite")}
              </button>
            </span>
          </div>
          <p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t(`multiAgents.guests.roleHint.${role}`)}
          </p>
          {error ? <p className="px-0.5 text-xs text-destructive">{error}</p> : null}
        </form>
      ) : (
        <button
          type="button"
          disabled={full}
          title={full ? t("multiAgents.guests.full", { count: GROUP_GUEST_LIMIT }) : undefined}
          className={cn(TEXT_BUTTON_CLASS, "-ml-2 self-start text-[13px]")}
          onClick={() => setInviting(true)}
        >
          <PlusIcon className="size-3.5" />
          {t("multiAgents.guests.add")}
        </button>
      )}
    </section>
  );
}

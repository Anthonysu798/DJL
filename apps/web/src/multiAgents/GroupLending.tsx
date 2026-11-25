// FILE: GroupLending.tsx
// Purpose: Lending one of your agents to someone else's group: the dialog that takes their
//          invite code and your choice of agent, and the short list of agents you have lent,
//          each with its live state and a way to take it back.
// Layer: UI component

import {
  PROVIDER_DISPLAY_NAMES,
  isGroupLendableProvider,
  type DesktopAgentLink,
  type GroupMemberProvider,
} from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { EllipsisIcon, XIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { joinErrorText, joinGroupAsAgent, leaveAgentLink } from "./agentLinks";
import { GroupAgentAvatar } from "./GroupAgentAvatar";
import { GROUP_MENU_CLASS, GroupChoiceMenu, GroupMenuHeader } from "./GroupMenu";
import { memberChoices } from "./GroupSetupDialog.logic";

const DEFAULT_MODEL = "__default__";
const providerName = (provider: string) =>
  PROVIDER_DISPLAY_NAMES[provider as GroupMemberProvider] ?? provider;

/** "ABCDEFGHJK" as people read it aloud: "ABCDE-FGHJK". */
export function formatInviteCode(raw: string): string {
  const code = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return code.length > 5 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

export function JoinGroupDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("shell");
  const [code, setCode] = useState("");
  const [provider, setProvider] = useState<GroupMemberProvider | null>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountsQuery = useQuery({
    queryKey: ["harness-accounts"],
    queryFn: () => ensureNativeApi().harnesses.listAccounts(),
    enabled: props.open,
  });
  // Only agents that are set up here, and that can run with no tools, can answer for you.
  const ready = memberChoices(accountsQuery.data?.accounts ?? [], {
    checkFailed: accountsQuery.isError,
  }).filter((choice) => choice.ready !== false && isGroupLendableProvider(choice.provider));
  const chosen = provider ?? ready[0]?.provider ?? null;
  const { modelOptionsByProvider } = useProviderModelCatalog({
    selectedProvider: chosen ?? "codex",
    discoveryEnabled: props.open,
  });
  const models = chosen ? (modelOptionsByProvider[chosen] ?? []) : [];
  const complete = code.replace("-", "").length === 10 && chosen !== null;

  useEffect(() => {
    if (props.open) return;
    setCode("");
    setProvider(null);
    setModel(DEFAULT_MODEL);
    setJoining(false);
    setError(null);
  }, [props.open]);

  const join = async () => {
    if (!complete || !chosen || joining) return;
    setJoining(true);
    setError(null);
    try {
      await joinGroupAsAgent({
        code,
        provider: chosen,
        model: model === DEFAULT_MODEL ? null : model,
      });
      props.onOpenChange(false);
    } catch (cause) {
      setError(joinErrorText(cause) || t("multiAgents.lend.failed"));
      setJoining(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md gap-0 overflow-hidden p-0" data-testid="join-group-dialog">
        <DialogHeader className="gap-1 px-5 pt-5 pr-12 pb-3">
          <DialogTitle className="text-[15px] font-medium tracking-[-0.01em]">
            {t("multiAgents.lend.title")}
          </DialogTitle>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("multiAgents.lend.description")}
          </p>
        </DialogHeader>
        <DialogPanel className="px-5 pt-1 pb-4">
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void join();
            }}
          >
            <Input
              autoFocus
              value={code}
              aria-label={t("multiAgents.lend.code")}
              placeholder={t("multiAgents.lend.code")}
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-[0.12em] uppercase placeholder:tracking-normal placeholder:normal-case"
              onChange={(event) => setCode(formatInviteCode(event.target.value))}
            />
            <div className="flex min-h-7 items-center justify-between gap-2 text-[13px]">
              <span className="text-[var(--color-text-foreground-secondary)]">
                {t("multiAgents.lend.agent")}
              </span>
              {chosen ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <GroupChoiceMenu
                    label={t("multiAgents.lend.agent")}
                    testId="join-group-agent"
                    value={chosen}
                    choices={ready.map((choice) => ({
                      value: choice.provider,
                      label: PROVIDER_DISPLAY_NAMES[choice.provider],
                      icon: <GroupAgentAvatar provider={choice.provider} size="xs" />,
                    }))}
                    onChange={(value) => {
                      setProvider(value as GroupMemberProvider);
                      setModel(DEFAULT_MODEL);
                    }}
                  />
                  <GroupChoiceMenu
                    label={t("multiAgents.members.model")}
                    testId="join-group-model"
                    value={model}
                    choices={[
                      { value: DEFAULT_MODEL, label: t("multiAgents.members.modelPlaceholder") },
                      ...models.map((option, index) => ({
                        value: option.slug,
                        label: option.name,
                        divided: index === 0,
                      })),
                    ]}
                    searchPlaceholder={t("multiAgents.members.modelSearch")}
                    onChange={setModel}
                  />
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {accountsQuery.isPending
                    ? t("multiAgents.lend.checking")
                    : t("multiAgents.lend.noAgent")}
                </span>
              )}
            </div>
            <p className="rounded-2xl bg-[var(--glass-control-fill)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-text-foreground-secondary)]">
              {t("multiAgents.lend.safety")} {t("multiAgents.lend.onlyClaude")}
            </p>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter className="items-center">
          <Button
            size="sm"
            variant="outline"
            className="mr-auto transition-transform duration-150 ease-out active:scale-[0.97]"
            onClick={() => props.onOpenChange(false)}
          >
            {t("multiAgents.guests.cancel")}
          </Button>
          <Button
            size="sm"
            className="transition-transform duration-150 ease-out active:scale-[0.97]"
            disabled={!complete || joining}
            onClick={() => void join()}
          >
            {joining ? t("multiAgents.lend.joining") : t("multiAgents.lend.submit")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function linkStatus(
  t: ReturnType<typeof useTranslation<"shell">>["t"],
  link: DesktopAgentLink,
): string {
  if (link.status === "connected" && link.busy) return t("multiAgents.lend.status.busy");
  return t(`multiAgents.lend.status.${link.status}`);
}

/** The agents lent to other groups, at the foot of the group list. */
export function LentAgentsList(props: { links: readonly DesktopAgentLink[] }) {
  const { t } = useTranslation("shell");
  if (props.links.length === 0) return null;
  return (
    <section aria-label={t("multiAgents.lend.section")} className="px-2 pb-1">
      <h2 className="flex h-7 items-center px-2 text-xs text-muted-foreground">
        {t("multiAgents.lend.section")}
      </h2>
      <ul className="flex flex-col gap-px">
        {props.links.map((link) => {
          const name = providerName(link.provider);
          const where = link.groupName ?? link.hostName ?? t("multiAgents.lend.unknownGroup");
          return (
            <li
              key={link.id}
              data-testid="lent-agent"
              data-status={link.status}
              className="flex h-11 items-center gap-2.5 rounded-lg pr-1 pl-2"
            >
              <span className="relative flex shrink-0">
                <GroupAgentAvatar provider={link.provider as GroupMemberProvider} size="sm" />
                <span
                  aria-hidden
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background transition-colors duration-300",
                    link.status === "connected"
                      ? link.busy
                        ? "animate-pulse bg-emerald-500 motion-reduce:animate-none"
                        : "bg-emerald-500"
                      : link.status === "refused"
                        ? "bg-destructive"
                        : "bg-muted-foreground/40",
                  )}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[13px]">{where}</span>
                <span className="truncate text-[11px] text-muted-foreground" role="status">
                  {name} · {linkStatus(t, link)}
                </span>
              </span>
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={t("multiAgents.members.options", { name: where })}
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.94] data-popup-open:text-foreground"
                    />
                  }
                >
                  <EllipsisIcon className="size-4" />
                </MenuTrigger>
                <MenuPopup
                  surface="liquid"
                  align="start"
                  sideOffset={6}
                  className={cn(GROUP_MENU_CLASS, "w-64")}
                >
                  <GroupMenuHeader
                    icon={
                      <GroupAgentAvatar provider={link.provider as GroupMemberProvider} size="md" />
                    }
                    title={link.handle ? `@${link.handle}` : name}
                    subtitle={[name, link.model, link.hostName].filter(Boolean).join(" · ")}
                  />
                  <MenuSeparator />
                  {link.message && link.status !== "connected" ? (
                    <p className="px-2 pb-1.5 text-xs leading-relaxed text-foreground/60">
                      {link.message}
                    </p>
                  ) : null}
                  <MenuItem variant="destructive" onClick={() => void leaveAgentLink(link.id)}>
                    <XIcon />
                    {t("multiAgents.lend.leave")}
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

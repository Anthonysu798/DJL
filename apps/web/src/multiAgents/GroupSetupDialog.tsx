// FILE: GroupSetupDialog.tsx
// Purpose: Two-step setup for a new group: pick agents (not-ready ones offer Set up), then name it.
// Layer: UI component

import { PROVIDER_DISPLAY_NAMES, type Group, type GroupMemberProvider } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
import { ArrowRightIcon, CheckIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import { GroupAgentAvatar } from "./GroupAgentAvatar";

import { canCreate, defaultGroupName, memberChoices } from "./GroupSetupDialog.logic";

const selectable = (ready: boolean | null) => ready !== false;

// Rows arrive one after another once, when the dialog opens.
const enter = (index: number) => ({
  className:
    "animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out [animation-fill-mode:backwards] motion-reduce:animate-none",
  style: { animationDelay: `${Math.min(index, 10) * 28}ms` },
});

export function GroupSetupDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (group: Group) => void;
}) {
  const { t } = useTranslation("shell");
  const navigate = useNavigate();
  const [step, setStep] = useState<"pick" | "name">("pick");
  const [selected, setSelected] = useState<GroupMemberProvider[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountsQuery = useQuery({
    queryKey: ["harness-accounts"],
    queryFn: () => ensureNativeApi().harnesses.listAccounts(),
    enabled: props.open,
  });
  const accounts = accountsQuery.data?.accounts ?? [];
  const check = { checkFailed: accountsQuery.isError };
  const choices = memberChoices(accounts, check);
  const checking = accountsQuery.isPending;

  useEffect(() => {
    if (!props.open) {
      setStep("pick");
      setSelected([]);
      setName("");
      setError(null);
    }
  }, [props.open]);

  const toggle = (provider: GroupMemberProvider) =>
    setSelected((current) =>
      current.includes(provider)
        ? current.filter((entry) => entry !== provider)
        : [...current, provider],
    );

  const create = async () => {
    // Only selectable agents can be ticked, so the picked list is the member list; re-checking
    // it here would drop members whenever the account check refreshes in between.
    const ready = selected;
    setCreating(true);
    setError(null);
    try {
      const group = await ensureNativeApi().groups.create({
        name: name.trim() || defaultGroupName(ready),
        members: ready.map((provider) => ({ provider })),
      });
      props.onCreated(group);
      props.onOpenChange(false);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "";
      setError(
        reason
          ? `${t("multiAgents.errors.createFailed")} ${reason}`
          : t("multiAgents.errors.createFailed"),
      );
    } finally {
      setCreating(false);
    }
  };

  const ready = choices.filter((choice) => selectable(choice.ready));
  const notReady = choices.filter((choice) => !selectable(choice.ready));
  const canContinue = canCreate(selected, accounts, check);
  const openAccounts = () => {
    props.onOpenChange(false);
    void navigate({ to: "/settings", search: { section: "accounts" } });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="gap-1 px-5 pt-5 pr-12 pb-3">
          <div className="mb-2 flex items-center gap-1" aria-hidden>
            {(["pick", "name"] as const).map((entry) => (
              <span
                key={entry}
                className={cn(
                  "h-1 rounded-full transition-[width,background-color] duration-300 ease-out",
                  entry === step ? "w-5 bg-foreground" : "w-1.5 bg-foreground/20",
                )}
              />
            ))}
          </div>
          <DialogTitle className="text-[15px] font-medium tracking-[-0.01em]">
            {step === "pick" ? t("multiAgents.setup.pickTitle") : t("multiAgents.setup.nameTitle")}
          </DialogTitle>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {step === "pick" ? t("multiAgents.setup.pickBody") : t("multiAgents.setup.nameBody")}
          </p>
        </DialogHeader>
        <DialogPanel className="max-h-[min(58vh,480px)] px-3 pt-1 pb-3">
          {step === "pick" ? (
            <div key="pick" className="flex flex-col">
              <ul className="flex flex-col gap-0.5">
                {(checking ? choices : ready).map((choice, index) => {
                  const picked = selected.includes(choice.provider);
                  const label = PROVIDER_DISPLAY_NAMES[choice.provider];
                  return (
                    <li key={choice.provider} {...enter(index)}>
                      <label
                        className={cn(
                          "group/agent flex h-12 items-center gap-3 rounded-xl px-2 transition-[background-color,transform] duration-150 ease-out",
                          checking
                            ? "text-muted-foreground"
                            : "cursor-pointer hover:bg-[var(--color-background-button-secondary-hover)] active:scale-[0.985]",
                          picked && "bg-[var(--color-background-button-secondary-hover)]",
                        )}
                      >
                        <GroupAgentAvatar
                          provider={choice.provider}
                          className={cn(
                            "size-8 rounded-[9px] transition-[transform,border-color,opacity] duration-200 ease-out [&_svg]:size-[17px]",
                            checking
                              ? "opacity-50"
                              : "group-hover/agent:scale-[1.06] group-active/agent:scale-100",
                            picked && "border-foreground/30",
                          )}
                        />
                        <span
                          className={cn(
                            "flex-1 text-[13px] transition-colors duration-150",
                            picked && "font-medium",
                          )}
                        >
                          {label}
                        </span>
                        {checking ? (
                          <span className="h-1.5 w-10 animate-pulse rounded-full bg-foreground/10">
                            <span className="sr-only">{t("multiAgents.setup.checking")}</span>
                          </span>
                        ) : null}
                        {/* The real checkbox is the drawn box, so the keyboard and screen
                            readers still get a native control. */}
                        <span
                          className={cn(
                            "relative flex size-5 shrink-0 items-center justify-center",
                            checking && "sr-only",
                          )}
                        >
                          <input
                            type="checkbox"
                            aria-label={label}
                            className="peer absolute inset-0 cursor-pointer appearance-none rounded-full border border-[color:var(--color-border)] transition-[background-color,border-color,transform] duration-200 ease-out group-hover/agent:border-foreground/40 checked:scale-100 checked:border-transparent checked:bg-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                            disabled={checking}
                            checked={picked}
                            onChange={() => toggle(choice.provider)}
                          />
                          <CheckIcon className="pointer-events-none relative size-3 scale-50 text-background opacity-0 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] peer-checked:scale-100 peer-checked:opacity-100" />
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {!checking && notReady.length > 0 ? (
                <>
                  <div
                    {...enter(ready.length)}
                    className={cn(
                      enter(ready.length).className,
                      "mt-3 flex items-center justify-between border-t border-[color:var(--color-border-light)] px-2 pt-3 pb-1",
                    )}
                  >
                    <span className="text-xs text-muted-foreground">
                      {t("multiAgents.setup.notReady")}
                    </span>
                    <button
                      type="button"
                      className="group/setup -mr-1 flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-[var(--color-text-foreground-secondary)] transition-[color,background-color,transform] duration-150 ease-out hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
                      onClick={openAccounts}
                    >
                      {t("multiAgents.setup.setUp")}
                      <ArrowRightIcon className="size-3 transition-transform duration-150 ease-out group-hover/setup:translate-x-0.5" />
                    </button>
                  </div>
                  <ul className="flex flex-wrap gap-1.5 px-2 pt-1.5">
                    {notReady.map((choice, index) => (
                      <li key={choice.provider} {...enter(ready.length + 1 + index)}>
                        <button
                          type="button"
                          title={t("multiAgents.setup.setUp")}
                          className="flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--color-border-light)] pr-2.5 pl-1 text-xs text-muted-foreground transition-[color,border-color,transform] duration-150 ease-out hover:border-[color:var(--color-border)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97]"
                          onClick={openAccounts}
                        >
                          <GroupAgentAvatar
                            provider={choice.provider}
                            size="xs"
                            className="rounded-full border-transparent bg-transparent opacity-70"
                          />
                          {PROVIDER_DISPLAY_NAMES[choice.provider]}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : (
            <div
              key="name"
              className="flex animate-in flex-col gap-4 px-2 pt-2 duration-300 ease-out fade-in slide-in-from-right-2 motion-reduce:animate-none"
            >
              <div className="flex -space-x-2">
                {selected.map((provider, index) => (
                  <GroupAgentAvatar
                    key={provider}
                    provider={provider}
                    className="size-10 animate-in rounded-xl ring-[3px] ring-popover duration-300 ease-out [animation-fill-mode:backwards] zoom-in-75 fade-in motion-reduce:animate-none [&_svg]:size-5"
                    style={{ animationDelay: `${index * 45}ms` }}
                  />
                ))}
              </div>
              <Input
                autoFocus
                value={name}
                placeholder={defaultGroupName(selected) || t("multiAgents.setup.namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create();
                }}
              />
            </div>
          )}
          {error ? <p className="mt-2 px-2 text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter className="items-center">
          {step === "pick" ? (
            <>
              <div className="mr-auto flex min-w-0 items-center gap-2">
                {selected.length > 0 ? (
                  <>
                    <span className="flex -space-x-1.5">
                      {selected.map((provider) => (
                        <GroupAgentAvatar
                          key={provider}
                          provider={provider}
                          size="sm"
                          className="animate-in ring-2 ring-popover duration-200 ease-out zoom-in-50 fade-in motion-reduce:animate-none"
                        />
                      ))}
                    </span>
                    <span className="truncate text-xs text-[var(--color-text-foreground-secondary)]">
                      {selected.map((provider) => PROVIDER_DISPLAY_NAMES[provider]).join(", ")}
                    </span>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("multiAgents.setup.needOne")}</p>
                )}
              </div>
              <Button
                size="sm"
                className="group/next transition-[opacity,transform,background-color] duration-200 ease-out active:scale-[0.97]"
                disabled={!canContinue}
                onClick={() => setStep("name")}
              >
                {t("multiAgents.setup.next")}
                <ArrowRightIcon className="size-3.5 transition-transform duration-150 ease-out group-hover/next:translate-x-0.5" />
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="mr-auto transition-transform duration-150 ease-out active:scale-[0.97]"
                onClick={() => setStep("pick")}
              >
                {t("multiAgents.setup.back")}
              </Button>
              <Button
                size="sm"
                className="transition-transform duration-150 ease-out active:scale-[0.97]"
                disabled={creating}
                onClick={() => void create()}
              >
                {creating ? t("multiAgents.setup.creating") : t("multiAgents.setup.create")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

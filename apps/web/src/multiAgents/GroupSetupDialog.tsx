// FILE: GroupSetupDialog.tsx
// Purpose: Two-step setup for a new group: pick agents (not-ready ones offer Set up), then name it.
// Layer: UI component

import { PROVIDER_DISPLAY_NAMES, type Group, type GroupMemberProvider } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ProviderIcon } from "~/components/ProviderIcon";
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
import { ensureNativeApi } from "~/nativeApi";

import { canCreate, defaultGroupName, memberChoices } from "./GroupSetupDialog.logic";

const selectable = (ready: boolean | null) => ready !== false;

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

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-lg gap-0 p-0">
        <DialogHeader className="gap-1 p-4 pr-12">
          <DialogTitle className="text-base">
            {step === "pick" ? t("multiAgents.setup.pickTitle") : t("multiAgents.setup.nameTitle")}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="max-h-[min(62vh,520px)] px-4 py-3">
          {step === "pick" ? (
            <ul className="flex flex-col gap-1">
              {choices.map((choice) => (
                <li key={choice.provider}>
                  <label
                    className={`flex items-center gap-3 rounded-lg px-2 py-2 ${selectable(choice.ready) && !checking ? "cursor-pointer hover:bg-muted" : "opacity-60"}`}
                  >
                    <input
                      type="checkbox"
                      disabled={checking || !selectable(choice.ready)}
                      checked={selected.includes(choice.provider)}
                      onChange={() => toggle(choice.provider)}
                    />
                    <ProviderIcon provider={choice.provider} className="size-5" />
                    <span className="flex-1 text-sm">
                      {PROVIDER_DISPLAY_NAMES[choice.provider]}
                    </span>
                    {checking ? (
                      <span className="text-xs text-muted-foreground">
                        {t("multiAgents.setup.checking")}
                      </span>
                    ) : selectable(choice.ready) ? null : (
                      <>
                        <span className="text-xs text-muted-foreground">
                          {t("multiAgents.setup.notReady")}
                        </span>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={(event) => {
                            event.preventDefault();
                            props.onOpenChange(false);
                            void navigate({ to: "/settings", search: { section: "accounts" } });
                          }}
                        >
                          {t("multiAgents.setup.setUp")}
                        </Button>
                      </>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <Input
              autoFocus
              value={name}
              placeholder={defaultGroupName(selected) || t("multiAgents.setup.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
            />
          )}
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          {step === "pick" ? (
            <>
              {!canCreate(selected, accounts, check) ? (
                <p className="mr-auto self-center text-xs text-muted-foreground">
                  {t("multiAgents.setup.needOne")}
                </p>
              ) : null}
              <Button
                size="sm"
                disabled={!canCreate(selected, accounts, check)}
                onClick={() => setStep("name")}
              >
                {t("multiAgents.setup.next")}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setStep("pick")}>
                {t("multiAgents.setup.back")}
              </Button>
              <Button size="sm" disabled={creating} onClick={() => void create()}>
                {creating ? t("multiAgents.setup.creating") : t("multiAgents.setup.create")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

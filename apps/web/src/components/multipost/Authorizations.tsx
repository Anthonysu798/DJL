import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MultiPostState, MultiPostWorkflow, MultiPostKind } from "@djl/contracts";
import { Button } from "~/components/ui/button";
import { calendarTimeToIso } from "../marketing/socialCalendar";
import { kinds, errorMessage, type CommandRunner } from "./shared";
export default function Authorizations({
  state,
  command,
  busy,
  initialWorkflowId,
}: {
  initialWorkflowId?: string;
  state: MultiPostState;
  command: CommandRunner;
  busy: boolean;
}) {
  const { t } = useTranslation("chat");
  const l = (key: string, fallback: string) => t(`multipost.${key}`, { defaultValue: fallback });
  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [types, setTypes] = useState<MultiPostKind[]>(["dynamic"]);
  const [selected, setSelected] = useState(initialWorkflowId ?? "");
  const [expiry, setExpiry] = useState("");
  const [validationError, setValidationError] = useState("");
  const [limit, setLimit] = useState(1);
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const workflow = state.workflows.find((x) => x.id === selected);
  return (
    <div className="mp-compose-layout">
      <section className="mp-panel">
        <h2>{l("workflow", "Workflow")}</h2>
        <label className="mp-field">
          <span>{l("workflowName", "Workflow name")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="mp-checklist">
          {kinds.map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={types.includes(kind)}
                onChange={(event) =>
                  setTypes((old) =>
                    event.target.checked ? [...old, kind] : old.filter((x) => x !== kind),
                  )
                }
              />
              {l(kind, kind)}
            </label>
          ))}
        </div>
        {state.accounts.map((account) => (
          <label className="mp-destination" key={account.id}>
            <input
              type="checkbox"
              checked={accounts.includes(account.id)}
              onChange={(event) =>
                setAccounts((old) =>
                  event.target.checked ? [...old, account.id] : old.filter((x) => x !== account.id),
                )
              }
            />{" "}
            {account.label}
          </label>
        ))}
        <Button
          disabled={busy || !name.trim() || !accounts.length || !types.length}
          onClick={() =>
            void command<MultiPostWorkflow>({
              action: "save-workflow",
              workflow: { name, accountIds: accounts, kinds: types },
            }).then((value) => {
              if (value) setSelected(value.id);
            })
          }
        >
          {l("saveWorkflow", "Save workflow")}
        </Button>
      </section>
      <section className="mp-panel">
        <h2>{l("standingAuthorization", "Standing publishing authorization")}</h2>
        <p>
          {l(
            "grantHint",
            "Allow this exact workflow to publish within the selected accounts, formats, expiry and daily limit. You can revoke it at any time.",
          )}
        </p>
        <label className="mp-field">
          <span>{l("workflow", "Workflow")}</span>
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">{l("chooseWorkflow", "Choose a saved workflow")}</option>
            {state.workflows.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name} · {value.revision}
              </option>
            ))}
          </select>
        </label>
        {workflow && (
          <p className="mp-muted">
            {workflow.accountIds
              .map((id) => state.accounts.find((a) => a.id === id)?.label ?? id)
              .join(", ")}{" "}
            · {workflow.kinds.join(", ")}
          </p>
        )}
        <label className="mp-field">
          <span>{l("expires", "Expires at")}</span>
          <input
            type="datetime-local"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </label>
        <label className="mp-field">
          <span>{l("dailyLimit", "Posts per day")}</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          />
        </label>
        <label className="mp-field">
          <span>{l("timezone", "Timezone")}</span>
          <input value={tz} onChange={(event) => setTz(event.target.value)} />
        </label>
        <Button
          disabled={busy || !workflow || !expiry || !limit}
          onClick={() => {
            if (workflow)
              try {
                void command({
                  action: "create-grant",
                  grant: {
                    workflowId: workflow.id,
                    workflowRevision: workflow.revision,
                    accountIds: workflow.accountIds,
                    kinds: workflow.kinds,
                    expiresAt: calendarTimeToIso(expiry, tz),
                    dailyLimit: limit,
                    timezone: tz,
                  },
                });
              } catch (error) {
                setValidationError(errorMessage(error));
              }
          }}
        >
          {l("authorizeWorkflow", "Authorize this workflow")}
        </Button>
        {validationError && (
          <p role="alert" className="mp-error">
            {validationError}
          </p>
        )}
        {state.grants.map((grant) => (
          <div className="mp-grant" key={grant.id}>
            <strong>{state.workflows.find((x) => x.id === grant.workflowId)?.name}</strong>
            <p>
              {grant.dailyLimit} / {l("day", "day")} · {new Date(grant.expiresAt).toLocaleString()}{" "}
              · {grant.timezone}
            </p>
            {grant.revokedAt ? (
              <span>{l("revoked", "Revoked")}</span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void command({ action: "revoke-grant", grantId: grant.id })}
              >
                {l("revoke", "Revoke authorization")}
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

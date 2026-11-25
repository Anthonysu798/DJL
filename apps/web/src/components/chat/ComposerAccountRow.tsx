// FILE: ComposerAccountRow.tsx
// Purpose: The subscription accounts for the picker's Claude Code / Codex tab, as a short list:
//          pick one for this chat, see how much usage each has left, and make it the default.
// Layer: Chat composer presentation. Data comes from ChatView (`useChatAccounts`); styles live
//        in index.css (`.composer-account-*`).

import { useTranslation } from "react-i18next";

import { CheckIcon } from "~/lib/icons";

export interface ComposerAccountOption {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly signedIn: boolean;
  /** Usage left in the tighter of the 5-hour / weekly windows, when known. */
  readonly leftPercent: number | null;
}

/** Amber once an account is nearly out, red when it has nothing left. */
function usageLevel(percent: number): "ok" | "low" | "out" {
  if (percent <= 0) return "out";
  return percent <= 10 ? "low" : "ok";
}

export function ComposerAccountRow(props: {
  accounts: ReadonlyArray<ComposerAccountOption>;
  selectedId: string;
  defaultId: string;
  onSelect: (id: string) => void;
  onMakeDefault: (id: string) => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className="composer-account-section">
      <div className="composer-account-header">
        <span>{t("modelPanel.account")}</span>
        {props.selectedId !== props.defaultId && (
          <button
            type="button"
            className="composer-account-default"
            onClick={() => props.onMakeDefault(props.selectedId)}
          >
            {t("modelPanel.makeDefault")}
          </button>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label={t("modelPanel.account")}
        className="grid grid-cols-[minmax(0,1fr)] gap-px"
      >
        {props.accounts.map((account) => {
          const selected = account.id === props.selectedId;
          const percent =
            account.signedIn && account.leftPercent !== null
              ? Math.round(account.leftPercent)
              : null;
          return (
            <button
              key={account.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!account.signedIn}
              title={account.email ?? account.name}
              className="composer-account-option"
              onClick={() => props.onSelect(account.id)}
            >
              <span className="composer-account-check" aria-hidden="true">
                <CheckIcon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{account.name}</span>
              {account.id === props.defaultId && (
                <span className="composer-account-tag">{t("modelPanel.accountDefaultTag")}</span>
              )}
              {!account.signedIn ? (
                <span className="composer-account-signed-out">
                  {t("modelPanel.accountSignedOut")}
                </span>
              ) : percent !== null ? (
                <span
                  className="composer-account-usage"
                  data-level={usageLevel(percent)}
                  aria-label={t("modelPanel.accountLeft", { percent })}
                >
                  <span className="composer-account-meter" aria-hidden="true">
                    <span style={{ width: `${Math.max(percent, 3)}%` }} />
                  </span>
                  <span aria-hidden="true" className="w-8 text-right tabular-nums">
                    {percent}%
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MultiPostAccount, MultiPostState } from "@djl/contracts";
import { Button } from "~/components/ui/button";
import type { CommandRunner } from "./shared";
export default function Accounts({
  state,
  command,
  busy,
}: {
  state: MultiPostState;
  command: CommandRunner;
  busy: boolean;
}) {
  const { t } = useTranslation("chat");
  const l = (key: string, fallback: string) => t(`multipost.${key}`, { defaultValue: fallback });
  const [platform, setPlatform] = useState("");
  const [name, setName] = useState("");
  const [homeUrl, setHomeUrl] = useState("");
  const platforms = [...new Map(state.capabilities.map((x) => [x.platformKey, x])).values()];
  return (
    <section className="mp-panel">
      <h2>{l("accounts", "Accounts")}</h2>
      <p className="mp-muted">
        {l(
          "accountHint",
          "Each account has its own browser session. Sign in, then verify the actual identity.",
        )}
      </p>
      <form
        className="mp-account-form"
        onSubmit={(event) => {
          event.preventDefault();
          void command<MultiPostAccount>({
            action: "create-account",
            platformKey: platform || platforms[0]!.platformKey,
            label: name,
            ...(homeUrl ? { homeUrl } : {}),
          }).then((account) => {
            if (account) {
              setName("");
              void command({ action: "connect-account", accountId: account.id });
            }
          });
        }}
      >
        <label className="mp-field">
          <span>{l("platform", "Platform")}</span>
          <select
            value={platform || platforms[0]?.platformKey || ""}
            onChange={(event) => setPlatform(event.target.value)}
          >
            {platforms.map((value) => (
              <option key={value.platformKey} value={value.platformKey}>
                {value.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="mp-field">
          <span>{l("accountName", "Account label")}</span>
          <input
            required
            value={name}
            placeholder={l("accountPlaceholder", "e.g. Personal or Brand team")}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {["webhook", "wordpress"].includes(platform || platforms[0]?.platformKey || "") && (
          <label className="mp-field">
            <span>{l("destinationUrl", "Custom publishing URL")}</span>
            <input
              type="url"
              required
              value={homeUrl}
              onChange={(event) => setHomeUrl(event.target.value)}
            />
          </label>
        )}
        <Button type="submit" disabled={busy || !platforms.length || !name.trim()}>
          {l("addAccount", "Add account")}
        </Button>
      </form>
      <div className="mp-account-grid">
        {state.accounts.map((account) => (
          <article className="mp-account" key={account.id}>
            <div className="mp-avatar" aria-hidden="true">
              {account.platformKey.slice(0, 2).toUpperCase()}
            </div>
            <h3>{account.label}</h3>
            <p>
              {account.identity
                ? `@${account.identity.username}`
                : l("identityUnverified", "Identity needs verification")}
            </p>
            <span className={`mp-status mp-status-${account.status}`}>
              {l(account.status, account.status.replaceAll("-", " "))}
            </span>
            <div className="mp-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void command({ action: "connect-account", accountId: account.id })}
              >
                {l("openLogin", "Open login")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void command({ action: "verify-account", accountId: account.id })}
              >
                {l("verifyIdentity", "Verify identity")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void command({ action: "disconnect-account", accountId: account.id })
                }
              >
                {l("disconnect", "Disconnect")}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

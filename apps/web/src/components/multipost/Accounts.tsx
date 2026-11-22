import { useState } from "react";
import type { MultiPostAccount, MultiPostCapability, MultiPostState } from "@djl/contracts";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { PlatformMark } from "./PlatformMark";
import {
  accountReady,
  autopilotOn,
  platformName,
  popularPlatforms,
  useMultiPostLocale,
  useMultiPostText,
  type CommandRunner,
} from "./shared";

const needsUrl = (platformKey: string) => ["webhook", "wordpress"].includes(platformKey);

export default function Accounts({
  state,
  command,
  busy,
}: {
  state: MultiPostState;
  command: CommandRunner;
  busy: boolean;
}) {
  const l = useMultiPostText();
  const date = new Intl.DateTimeFormat(useMultiPostLocale(), { dateStyle: "medium" });
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [urlFor, setUrlFor] = useState<MultiPostCapability | null>(null);
  const [homeUrl, setHomeUrl] = useState("");
  const platforms = [...new Map(state.capabilities.map((x) => [x.platformKey, x])).values()];
  const popular = popularPlatforms.flatMap(
    (key) => platforms.find((x) => x.platformKey === key) ?? [],
  );
  const query = search.trim().toLowerCase();
  const tiles = query
    ? platforms.filter((x) => `${platformName(x)} ${x.platformKey}`.toLowerCase().includes(query))
    : showAll || !popular.length
      ? platforms
      : popular;
  const name = (platformKey: string) => {
    const platform = platforms.find((x) => x.platformKey === platformKey);
    return platform ? platformName(platform) : platformKey;
  };

  const add = async (platform: MultiPostCapability, url?: string) => {
    if (needsUrl(platform.platformKey) && !url) {
      setUrlFor(platform);
      return;
    }
    const taken = new Set(state.accounts.map((account) => account.label));
    let label = platformName(platform);
    for (let n = 2; taken.has(label); n++) label = `${platformName(platform)} ${n}`;
    const account = await command<MultiPostAccount>({
      action: "create-account",
      platformKey: platform.platformKey,
      label,
      ...(url ? { homeUrl: url } : {}),
    });
    if (!account) return;
    setUrlFor(null);
    setHomeUrl("");
    await command({ action: "connect-account", accountId: account.id });
  };
  /** A first successful sign-in puts the account on Autopilot; the switch is right on its card. */
  const confirm = async (account: MultiPostAccount) => {
    const verified = await command<MultiPostAccount>(
      { action: "verify-account", accountId: account.id },
      l(
        "signInNotSeen",
        "We couldn't see your account yet. Finish signing in in the window that opened, then try again.",
      ),
    );
    if (verified?.status === "connected" && !account.identity)
      await command({ action: "set-autopilot", accountId: account.id, enabled: true });
  };
  const signIn = (account: MultiPostAccount) =>
    void command({ action: "connect-account", accountId: account.id });

  const active = state.accounts.filter((account) => account.status !== "disconnected");
  const signedOut = state.accounts.filter((account) => account.status === "disconnected");
  const grants = state.grants.filter((grant) => !grant.revokedAt);
  return (
    <div className="mp-accounts">
      {active.length > 0 && (
        <section className="mp-account-list" aria-label={l("accounts", "Accounts")}>
          {active.map((account) => {
            const ready = accountReady(account, state.capabilities);
            const on = autopilotOn(account);
            // It was signed in before, so this is the platform signing the person out.
            const lapsed = !ready && Boolean(account.identity);
            return (
              <article className="mp-account" key={account.id} data-ready={ready || undefined}>
                <header>
                  <PlatformMark platformKey={account.platformKey} name={account.label} />
                  <div>
                    <h3>{account.label}</h3>
                    <p className="mp-muted">
                      {[
                        account.identity &&
                          !account.label.includes(account.identity.username) &&
                          `@${account.identity.username}`,
                        account.label !== name(account.platformKey) && name(account.platformKey),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="mp-pill" data-tone={ready ? "good" : "warn"}>
                    {ready
                      ? l("ready", "Ready")
                      : lapsed
                        ? l("signedOutPill", "Signed out")
                        : l("finishSigningIn", "Finish signing in")}
                  </span>
                </header>
                {!ready && (
                  <div className="mp-guide">
                    <p>
                      {lapsed
                        ? l(
                            "signedOutGuide",
                            "{{name}} signed you out, so posts here are on hold. Sign in again, then press the button.",
                            { name: name(account.platformKey) },
                          )
                        : l(
                            "signInGuide",
                            "A sign-in window opened. Sign in there as usual, then come back and press the button.",
                          )}
                    </p>
                    <div className="mp-actions">
                      <Button disabled={busy} onClick={() => void confirm(account)}>
                        {l("imSignedIn", "I'm signed in")}
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => signIn(account)}>
                        {l("openSignIn", "Open sign-in window")}
                      </Button>
                    </div>
                  </div>
                )}
                {ready && !account.identity && (
                  <p className="mp-guide">
                    {l(
                      "manualFinish",
                      "DJL fills in your post here. You press the final Publish button yourself.",
                    )}
                  </p>
                )}
                {account.status === "connected" && (
                  <div className="mp-autopilot" data-on={on || undefined}>
                    <div>
                      <strong>{l("autopilot", "Autopilot")}</strong>
                      <p className="mp-muted">
                        {on
                          ? l(
                              "autopilotOnHint",
                              "The agent posts here without asking, up to {{n}} a day, until {{date}}.",
                              {
                                n: account.autopilot!.dailyLimit,
                                date: date.format(new Date(account.autopilot!.expiresAt)),
                              },
                            )
                          : l("autopilotOffHint", "The agent asks you before posting.")}
                      </p>
                    </div>
                    {on && (
                      <select
                        aria-label={l("dailyLimit", "Posts per day")}
                        value={account.autopilot!.dailyLimit}
                        disabled={busy}
                        onChange={(event) =>
                          void command({
                            action: "set-autopilot",
                            accountId: account.id,
                            enabled: true,
                            dailyLimit: Number(event.target.value),
                          })
                        }
                      >
                        {[...new Set([1, 3, 5, 10, 20, account.autopilot!.dailyLimit])]
                          .toSorted((a, b) => a - b)
                          .map((n) => (
                            <option key={n} value={n}>
                              {l("perDay", "{{n}} a day", { n })}
                            </option>
                          ))}
                      </select>
                    )}
                    <Switch
                      checked={on}
                      disabled={busy}
                      aria-label={l("autopilotFor", "Autopilot for {{name}}", {
                        name: account.label,
                      })}
                      onCheckedChange={(enabled) =>
                        void command({ action: "set-autopilot", accountId: account.id, enabled })
                      }
                    />
                  </div>
                )}
                <footer className="mp-actions">
                  {ready && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => signIn(account)}
                    >
                      {l("openSignIn", "Open sign-in window")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void command({ action: "disconnect-account", accountId: account.id })
                    }
                  >
                    {l("signOut", "Sign out")}
                  </Button>
                </footer>
              </article>
            );
          })}
        </section>
      )}
      <section className="mp-card">
        <h2>
          {active.length
            ? l("addAnotherAccount", "Add another account")
            : l("connectFirst", "Connect your first account")}
        </h2>
        <p className="mp-muted">
          {l(
            "accountHint",
            "Pick where you post. You sign in once, in a private window that only DJL uses.",
          )}
        </p>
        <input
          className="mp-search"
          type="search"
          aria-label={l("searchPlatforms", "Search platforms")}
          placeholder={l("searchPlatformsPlaceholder", "Search {{n}} platforms", {
            n: platforms.length,
          })}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="mp-tiles">
          {tiles.map((platform) => (
            <button
              type="button"
              className="mp-tile"
              key={platform.platformKey}
              disabled={busy}
              onClick={() => void add(platform)}
            >
              <PlatformMark platformKey={platform.platformKey} name={platformName(platform)} />
              <span>{platformName(platform)}</span>
            </button>
          ))}
        </div>
        {!tiles.length && <p className="mp-muted">{l("noPlatform", "No platform matches.")}</p>}
        {!query && popular.length > 0 && platforms.length > popular.length && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
            {showAll
              ? l("showPopular", "Show popular only")
              : l("showAllPlatforms", "Show all {{n}} platforms", { n: platforms.length })}
          </Button>
        )}
        {urlFor && (
          <form
            className="mp-url-form"
            onSubmit={(event) => {
              event.preventDefault();
              void add(urlFor, homeUrl);
            }}
          >
            <label className="mp-field">
              <span>{l("addressFor", "Address for {{name}}", { name: platformName(urlFor) })}</span>
              <input
                type="url"
                required
                autoFocus
                placeholder="https://"
                value={homeUrl}
                onChange={(event) => setHomeUrl(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || !homeUrl}>
              {l("addAccount", "Add account")}
            </Button>
          </form>
        )}
      </section>
      {signedOut.length > 0 && (
        <details className="mp-card mp-signed-out">
          <summary>{l("signedOut", "Signed out ({{n}})", { n: signedOut.length })}</summary>
          {signedOut.map((account) => (
            <div className="mp-row" key={account.id}>
              <PlatformMark platformKey={account.platformKey} name={account.label} />
              <span>{account.label}</span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => signIn(account)}>
                {l("signIn", "Sign in")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={l("removeAccount", "Remove {{name}}", { name: account.label })}
                onClick={() => void command({ action: "remove-account", accountId: account.id })}
              >
                {l("remove", "Remove")}
              </Button>
            </div>
          ))}
        </details>
      )}
      {grants.length > 0 && (
        <section className="mp-card">
          <h2>{l("olderPermissions", "Older permissions")}</h2>
          <p className="mp-muted">
            {l(
              "olderPermissionsHint",
              "These were set up before Autopilot. They keep working until you revoke them.",
            )}
          </p>
          {grants.map((grant) => (
            <div className="mp-row" key={grant.id}>
              <span>
                <strong>{state.workflows.find((x) => x.id === grant.workflowId)?.name}</strong>
                <small className="mp-muted">
                  {" "}
                  {l("perDay", "{{n}} a day", { n: grant.dailyLimit })} ·{" "}
                  {date.format(new Date(grant.expiresAt))}
                </small>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void command({ action: "revoke-grant", grantId: grant.id })}
              >
                {l("revoke", "Revoke authorization")}
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

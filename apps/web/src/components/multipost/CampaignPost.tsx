import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MultiPostQuickPostResult } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { calendarTimeToIso } from "../marketing/socialCalendar";
import { multiPostCommand, multiPostState } from "./client";
import { AccountChips, skippedText, WhenPicker } from "./PostControls";
import { accountReady, errorMessage, useMultiPostText } from "./shared";

/** A preview names a few platforms differently from the accounts list. */
const previewPlatform = (key: string) => ({ rednote: "red", weixinchannel: "wechat" })[key] ?? key;

/** Posts a saved preview through the accounts signed in on this computer. No cloud account. */
export function CampaignPost({
  threadId,
  campaignId,
  version,
  platforms,
  disabled,
  onPosted,
  onAccounts,
}: {
  threadId: string;
  campaignId: string;
  version: number;
  platforms: readonly string[];
  disabled?: boolean;
  onPosted: () => void;
  onAccounts?: (() => void) | undefined;
}) {
  const l = useMultiPostText();
  const client = useQueryClient();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = useQuery({
    queryKey: ["multipost", threadId],
    queryFn: () => multiPostState(threadId),
    retry: false,
    refetchInterval: 3000,
  });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [later, setLater] = useState(false);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<MultiPostQuickPostResult["skipped"]>([]);
  const ready = (query.data?.accounts ?? []).filter((account) =>
    accountReady(account, query.data!.capabilities),
  );
  const written = ready.filter((account) =>
    platforms.includes(previewPlatform(account.platformKey)),
  );
  const chosen = picked ?? new Set((written.length ? written : ready).map((account) => account.id));
  const accountIds = ready.filter((account) => chosen.has(account.id)).map((account) => account.id);
  const post = async () => {
    setBusy(true);
    setError("");
    setSkipped([]);
    try {
      const result = await multiPostCommand<MultiPostQuickPostResult>(threadId, {
        action: "import-campaign",
        campaignId,
        version,
        accountIds,
        post: true,
        ...(later ? { scheduledAt: calendarTimeToIso(date, timezone) } : {}),
        timezone,
      });
      void client.invalidateQueries({ queryKey: ["multipost"] });
      if (result.jobs.length && !result.skipped?.length) onPosted();
      else setSkipped(result.skipped ?? []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mp-campaign-post">
      <h4>{l("postTo", "Post to")}</h4>
      {ready.length ? (
        <AccountChips
          accounts={ready}
          selected={(account) => chosen.has(account.id)}
          onToggle={(account, on) => {
            const next = new Set(chosen);
            if (on) next.add(account.id);
            else next.delete(account.id);
            setPicked(next);
          }}
        >
          {onAccounts && (
            <button type="button" className="mp-chip mp-chip-add" onClick={onAccounts}>
              {l("addAnother", "+ Add account")}
            </button>
          )}
        </AccountChips>
      ) : (
        !query.isPending && (
          <div className="mp-actions">
            <p className="mp-muted">
              {l("campaignNoAccounts", "Sign in to a social account once, then post from here.")}
            </p>
            {onAccounts && (
              <Button variant="outline" size="sm" onClick={onAccounts}>
                {l("campaignAddAccount", "Add an account")}
              </Button>
            )}
          </div>
        )
      )}
      <WhenPicker
        later={later}
        date={date}
        timezone={timezone}
        onLater={setLater}
        onDate={setDate}
      />
      {skipped.map((item) => (
        <p className="mp-warn" role="status" key={item.accountId}>
          {l(skippedText[item.reason][0], skippedText[item.reason][1], { name: item.label })}
        </p>
      ))}
      {error && (
        <p role="alert" className="mp-error">
          {error}
        </p>
      )}
      <Button
        size="lg"
        className="mp-post"
        disabled={disabled || busy || !accountIds.length || (later && !date)}
        onClick={() => void post()}
      >
        {busy
          ? l("working", "Working…")
          : later
            ? l("schedulePost", "Schedule post")
            : l("postNow", "Post now")}
      </Button>
    </section>
  );
}

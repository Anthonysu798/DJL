import Composer from "./Composer";
import QuickComposer from "./QuickComposer";
import QuickActions from "./QuickActions";
import Accounts from "./Accounts";
import { Activity, needsAttention } from "./Activity";
import { errorMessage, useMultiPostText, type MultiPostView } from "./shared";
import { movable, MultiPostCalendar } from "./MultiPostCalendar";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft, IconSparkles } from "@tabler/icons-react";
import type { MultiPostCommand, MultiPostDraft, MultiPostState } from "@synara/contracts";
import { Button } from "~/components/ui/button";

import { multiPostCommand, multiPostState } from "./client";
import { MultiPostReview } from "./MultiPostReview";
import "./multipost.css";
const empty: MultiPostState = {
  accounts: [],
  drafts: [],
  jobs: [],
  workflows: [],
  grants: [],
  capabilities: [],
  runtimeAvailable: false,
};
type Tab = "compose" | "accounts" | "queue" | "resources";
export default function MultiPostWorkspace({
  threadId,
  onBack,
  onPrompt,
  resources,
  legacyCampaign,
  initialView,
}: {
  initialView?: MultiPostView;
  /** Older agent links still carry this; permissions now live on each account. */
  initialWorkflowId?: string;
  legacyCampaign?: { id: string; version: number };
  threadId: string;
  onBack: () => void;
  onPrompt?: (text: string) => Promise<boolean>;
  resources?: ReactNode;
}) {
  const l = useMultiPostText();
  const cache = useQueryClient();
  const [tab, setTab] = useState<Tab>(
    initialView === "authorizations" ? "accounts" : (initialView ?? "compose"),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [editing, setEditing] = useState<MultiPostDraft | null>(null);
  const [ask, setAsk] = useState("");
  const query = useQuery({
    queryKey: ["multipost", threadId],
    queryFn: () => multiPostState(threadId),
    retry: false,
    refetchInterval: 3000,
  });
  const state = query.data ?? empty;
  // Once per visit DJL makes sure every account is still signed in; the server skips recent checks.
  useEffect(() => {
    void multiPostCommand(threadId, { action: "check-accounts" }).then(
      () => cache.invalidateQueries({ queryKey: ["multipost"] }),
      () => {},
    );
  }, [threadId, cache]);
  const lapsed = state.accounts.filter(
    (account) => account.status === "needs-login" && account.identity,
  );
  const updated = () => {
    void cache.invalidateQueries({ queryKey: ["multipost"] });
  };
  const command = async <T,>(
    input: MultiPostCommand,
    friendly?: string,
  ): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    try {
      const result = await multiPostCommand<T>(threadId, input);
      updated();
      return result;
    } catch (e) {
      setError(friendly ?? errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const waiting = state.drafts.filter(
    (draft) =>
      draft.threadId === threadId &&
      !state.jobs.some((job) => job.draftId === draft.id && job.revision === draft.revision),
  );
  const attention = state.jobs.filter(needsAttention).length;
  const tabs: [Tab, string][] = [
    ["compose", l("create", "Create")],
    ...(onPrompt ? ([["resources", l("oneClick", "One-click")]] as [Tab, string][]) : []),
    ["accounts", l("accounts", "Accounts")],
    ["queue", l("activity", "Activity")],
  ];
  return (
    <main className="mp-workspace">
      <header className="mp-header">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <IconArrowLeft size={16} />
          {l("back", "Back to chat")}
        </Button>
        <h1>DJL MultiPost</h1>
        <p>{l("intro", "Write once. Post everywhere.")}</p>
      </header>
      <nav className="mp-tabs" role="tablist" aria-label="MultiPost">
        {tabs.map(([id, title]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {title}
            {id === "queue" && attention > 0 && <span className="mp-badge">{attention}</span>}
          </button>
        ))}
      </nav>
      {(error || query.isError) && (
        <div className="mp-error mp-banner" role="alert">
          {error || errorMessage(query.error)}{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError("");
              void query.refetch();
            }}
          >
            {l("retry", "Try again")}
          </Button>
        </div>
      )}
      {query.isPending ? (
        <div className="mp-card mp-skeleton" role="status">
          <span className="sr-only">{l("loading", "Loading your workspace…")}</span>
        </div>
      ) : (
        <>
          {lapsed.length > 0 && tab !== "accounts" && (
            <p className="mp-notice mp-notice-action" role="status">
              {l(
                "signedOutBanner",
                "{{names}} signed you out. Sign in again so your posts keep going out.",
                { names: lapsed.map((account) => account.label).join(", ") },
              )}
              <Button size="sm" onClick={() => setTab("accounts")}>
                {l("signInAgain", "Sign in again")}
              </Button>
            </p>
          )}
          {!state.runtimeAvailable && (
            <p className="mp-notice">
              {l(
                "desktopRequired",
                "Open the DJL desktop app to sign in to accounts and post. You can still write here.",
              )}
            </p>
          )}
          {/* Stays mounted so a half-written post survives a visit to another tab. */}
          <div className="mp-view" hidden={tab !== "compose"}>
            {!state.accounts.length && (
              <section className="mp-card mp-welcome">
                <h2>{l("welcome", "Post everywhere in three steps")}</h2>
                <ol className="mp-steps">
                  <li>
                    <strong>{l("stepConnect", "Connect an account")}</strong>
                    <span>
                      {l("stepConnectHint", "Sign in to Instagram, TikTok or any other.")}
                    </span>
                  </li>
                  <li>
                    <strong>{l("stepWrite", "Write your post")}</strong>
                    <span>{l("stepWriteHint", "Add words, photos or a video.")}</span>
                  </li>
                  <li>
                    <strong>{l("stepPost", "Press Post")}</strong>
                    <span>{l("stepPostHint", "Or just ask the agent to do it all.")}</span>
                  </li>
                </ol>
                <Button size="lg" onClick={() => setTab("accounts")}>
                  {l("stepConnect", "Connect an account")}
                </Button>
              </section>
            )}
            {state.accounts.length > 0 && (
              <div className="mp-create">
                <div>
                  {advanced ? (
                    <>
                      <Composer
                        key={`${editing?.id ?? "new"}-${editing?.revision ?? 0}`}
                        threadId={threadId}
                        state={state}
                        initial={editing}
                        busy={busy}
                        onSave={(draft) =>
                          command<MultiPostDraft>({ action: "save-draft", draft }).then((value) => {
                            if (value) setEditing(value);
                          })
                        }
                        onError={setError}
                      />
                      <div className="mp-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAdvanced(false);
                            setEditing(null);
                          }}
                        >
                          {l("backToSimple", "Back to the simple editor")}
                        </Button>
                        {legacyCampaign && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void command<MultiPostDraft>({
                                action: "import-campaign",
                                campaignId: legacyCampaign.id,
                                version: legacyCampaign.version,
                              }).then((value) => {
                                if (value) setEditing(value);
                              })
                            }
                          >
                            {l("importCampaign", "Import existing campaign")}
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <QuickComposer
                        threadId={threadId}
                        state={state}
                        onPosted={updated}
                        onSeeProgress={() => setTab("queue")}
                        onAccounts={() => setTab("accounts")}
                      />
                      <Button variant="ghost" size="sm" onClick={() => setAdvanced(true)}>
                        {l("advancedEditor", "Advanced editor")}
                      </Button>
                      <span className="mp-muted mp-advanced-hint">
                        {l("advancedHint", "Articles, podcasts and per-platform options")}
                      </span>
                    </>
                  )}
                </div>
                <aside>
                  {onPrompt && (
                    <form
                      className="mp-card mp-agent"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void onPrompt(
                          `$multipost-publish ${ask.trim() || "Help me write a post and publish it to my connected accounts."}`,
                        ).then((started) => {
                          if (started) onBack();
                        });
                      }}
                    >
                      <h2>
                        <IconSparkles size={16} aria-hidden="true" />
                        {l("letAgent", "Or let the agent do it")}
                      </h2>
                      <p className="mp-muted">
                        {l(
                          "letAgentHint",
                          "Say what you want. The agent writes it, makes the image and posts it. With Autopilot on it posts without asking; otherwise you get a preview first.",
                        )}
                      </p>
                      <textarea
                        rows={3}
                        aria-label={l("tellAgent", "Tell the agent what to post")}
                        placeholder={l(
                          "tellAgentPlaceholder",
                          "Make an image for our weekend sale and post it everywhere",
                        )}
                        value={ask}
                        onChange={(event) => setAsk(event.target.value)}
                      />
                      <Button type="submit" variant="outline">
                        {l("askAgent", "Ask the agent")}
                      </Button>
                    </form>
                  )}
                  {waiting.length > 0 && (
                    <section className="mp-waiting">
                      <h2>{l("waitingForOk", "Waiting for your OK")}</h2>
                      {waiting.map((draft) => (
                        <MultiPostReview
                          key={`${draft.id}-${draft.revision}`}
                          threadId={threadId}
                          draft={draft}
                          accounts={state.accounts}
                          onUpdated={updated}
                          onEdit={() => {
                            setEditing(draft);
                            setAdvanced(true);
                          }}
                        />
                      ))}
                    </section>
                  )}
                </aside>
              </div>
            )}
          </div>
          {tab === "accounts" && (
            <div className="mp-view">
              <Accounts state={state} command={command} busy={busy} />
            </div>
          )}
          {tab === "queue" && (
            <section className="mp-card mp-view">
              <h2>{l("activity", "Activity")}</h2>
              {state.jobs.length ? (
                <>
                  <Activity
                    jobs={state.jobs}
                    accounts={state.accounts}
                    busy={busy}
                    onCommand={(input) => void command(input)}
                    onAccounts={() => setTab("accounts")}
                  />
                  <details
                    className="mp-week"
                    open={state.jobs.some((job) => movable(job)) || undefined}
                  >
                    <summary>{l("calendar", "Publishing calendar")}</summary>
                    <MultiPostCalendar
                      jobs={state.jobs}
                      accounts={state.accounts}
                      busy={busy}
                      timezone={Intl.DateTimeFormat().resolvedOptions().timeZone}
                      onMove={(jobId, scheduledAt) =>
                        void command({ action: "reschedule-job", jobId, scheduledAt })
                      }
                    />
                  </details>
                  <p className="mp-muted">
                    {l(
                      "backgroundHint",
                      "Keep DJL running for scheduled posts. Closing the window is fine; quitting the app is not.",
                    )}
                  </p>
                </>
              ) : (
                <div className="mp-empty">
                  <h3>{l("queueEmpty", "Nothing here yet")}</h3>
                  <p>{l("queueEmptyHint", "Posts you send or schedule show up here.")}</p>
                  <Button onClick={() => setTab("compose")}>
                    {l("createPost", "Create a post")}
                  </Button>
                </div>
              )}
            </section>
          )}
          {tab === "resources" && onPrompt && (
            <div className="mp-view">
              <QuickActions
                threadId={threadId}
                state={state}
                onAccounts={() => setTab("accounts")}
                onPrompt={(text) =>
                  onPrompt(text).then((started) => {
                    if (started) onBack();
                    return started;
                  })
                }
                {...(resources ? { resources } : {})}
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}

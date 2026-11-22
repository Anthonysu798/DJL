import Composer from "./Composer";
import Accounts from "./Accounts";
import Authorizations from "./Authorizations";
import { errorMessage, type MultiPostView } from "./shared";
import { MultiPostCalendar } from "./MultiPostCalendar";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { IconArrowLeft, IconPlus, IconArrowUpRight } from "@tabler/icons-react";
import type { MultiPostCommand, MultiPostDraft, MultiPostState } from "@djl/contracts";
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
export default function MultiPostWorkspace({
  threadId,
  onBack,
  onPrompt,
  resources,
  legacyCampaign,
  initialView,
  initialWorkflowId,
}: {
  initialView?: MultiPostView;
  initialWorkflowId?: string;
  legacyCampaign?: { id: string; version: number };
  threadId: string;
  onBack: () => void;
  onPrompt?: (text: string) => Promise<boolean>;
  resources?: ReactNode;
}) {
  const { t } = useTranslation("chat");
  const l = (key: string, fallback: string) => t(`multipost.${key}`, { defaultValue: fallback });
  const cache = useQueryClient();
  const [tab, setTab] = useState<MultiPostView>(initialView ?? "compose");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<MultiPostDraft | null>(null);
  const [fresh, setFresh] = useState(0);
  const query = useQuery({
    queryKey: ["multipost", threadId],
    queryFn: () => multiPostState(threadId),
    retry: false,
    refetchInterval: 3000,
  });
  const state = query.data ?? empty;
  const updated = () => {
    void cache.invalidateQueries({ queryKey: ["multipost"] });
  };
  const command = async <T,>(input: MultiPostCommand): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    try {
      const result = await multiPostCommand<T>(threadId, input);
      updated();
      return result;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const tabs: [MultiPostView, string][] = [
    ["compose", l("compose", "Compose")],
    ["accounts", l("accounts", "Accounts")],
    ["queue", l("queue", "Queue & history")],
    ["authorizations", l("authorizations", "Workflows & authorizations")],
    ["resources", l("resources", "Brand & media tools")],
  ];
  return (
    <main className="mp-workspace">
      <header className="mp-header">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <IconArrowLeft size={16} />
            {l("back", "Back to chat")}
          </Button>
          <h1>DJL MultiPost</h1>
          <p>{l("intro", "One place for every post, account, and publishing task.")}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFresh((x) => x + 1);
            setTab("compose");
          }}
        >
          <IconPlus size={16} />
          {l("newPost", "New post")}
        </Button>
      </header>
      <nav className="mp-tabs" role="tablist" aria-label="MultiPost">
        {tabs.map(([id, title]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id!)}>
            {title}
          </button>
        ))}
      </nav>
      {(error || query.isError) && (
        <div className="mp-error" role="alert">
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
        <p role="status">{l("loading", "Loading your workspace…")}</p>
      ) : (
        <>
          {!state.runtimeAvailable && tab !== "resources" && (
            <p className="mp-notice">
              {l(
                "desktopRequired",
                "Open DJL desktop to connect accounts and execute publishing. Drafts remain editable here.",
              )}
            </p>
          )}
          {tab === "compose" && (
            <div className="mp-compose-layout">
              <div>
                <Composer
                  key={`${editing?.id ?? "new"}-${editing?.revision ?? fresh}`}
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
                {onPrompt && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      void onPrompt(
                        "$multipost-compose Help me prepare platform-specific content in this conversation. Inspect my real media first and save a draft with DJL multipost mcp; do not authorize publication.",
                      ).then((started) => {
                        if (started) onBack();
                      });
                    }}
                  >
                    {l("askAgent", "Ask the agent to help")}
                    <IconArrowUpRight size={14} />
                  </Button>
                )}
              </div>
              <aside className="mp-drafts">
                <div className="mp-section-heading">
                  <h2>{l("drafts", "Saved drafts")}</h2>
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
                  <span>{state.drafts.filter((d) => d.threadId === threadId).length}</span>
                </div>
                {state.drafts
                  .filter((d) => d.threadId === threadId)
                  .map((draft) => (
                    <section key={`${draft.id}-${draft.revision}`}>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(draft)}>
                        {l("edit", "Edit")} · {draft.data.title}
                      </Button>
                      {state.jobs.some(
                        (job) => job.draftId === draft.id && job.revision === draft.revision,
                      ) ? (
                        <Button variant="outline" size="sm" onClick={() => setTab("queue")}>
                          {l("queue", "Queue & history")}
                        </Button>
                      ) : (
                        <MultiPostReview
                          threadId={threadId}
                          draft={draft}
                          accounts={state.accounts}
                          onUpdated={updated}
                        />
                      )}
                    </section>
                  ))}
                {!state.drafts.some((d) => d.threadId === threadId) && (
                  <div className="mp-empty">
                    <h3>{l("draftEmpty", "Your next post starts here.")}</h3>
                    <p>
                      {l(
                        "draftHint",
                        "Choose a format and accounts, add your content, then save a draft for review.",
                      )}
                    </p>
                    <Button variant="outline" onClick={() => setTab("accounts")}>
                      {l("connectAccounts", "Connect accounts")}
                    </Button>
                  </div>
                )}
              </aside>
            </div>
          )}
          {tab === "accounts" && <Accounts state={state} command={command} busy={busy} />}
          {tab === "queue" && (
            <section className="mp-panel">
              <h2>{l("queue", "Queue & history")}</h2>
              <MultiPostCalendar
                jobs={state.jobs}
                timezone={Intl.DateTimeFormat().resolvedOptions().timeZone}
              />
              <p className="mp-muted">
                {l(
                  "backgroundHint",
                  "Keep DJL running in the tray for scheduled tasks. Missed tasks wait for your review.",
                )}
              </p>
              {!state.jobs.length && (
                <div className="mp-empty">{l("queueEmpty", "No publishing tasks yet.")}</div>
              )}
              {state.jobs.map((job) => (
                <article className="mp-job" id={`mp-job-${job.id}`} key={job.id}>
                  <div>
                    <span className={`mp-status mp-status-${job.state}`}>
                      {l(job.state, job.state.replaceAll("-", " "))}
                    </span>
                    <h3>{job.snapshot.data.title}</h3>
                    <p>
                      {state.accounts.find((a) => a.id === job.accountId)?.label} ·{" "}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: job.snapshot.timezone,
                      }).format(new Date(job.dueAt))}{" "}
                      · {job.snapshot.timezone}
                    </p>
                    {job.error && <p className="mp-error">{job.error}</p>}
                    {job.evidence?.message && <p>{job.evidence.message}</p>}
                    {job.evidence?.postUrl && (
                      <a href={job.evidence.postUrl} target="_blank" rel="noopener noreferrer">
                        {l("viewPost", "View post")} ↗
                      </a>
                    )}
                  </div>
                  <div className="mp-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void command({ action: "open-job", jobId: job.id })}
                    >
                      {l("openPlatform", "Open platform")}
                    </Button>
                    {["prepared", "scheduled-on-platform", "uncertain"].includes(job.state) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void command({ action: "verify-job", jobId: job.id })}
                      >
                        {l("verifyResult", "Verify result")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void command({ action: "close-job", jobId: job.id })}
                    >
                      {l("closePage", "Close page")}
                    </Button>
                    {[
                      "queued",
                      "preparing",
                      "prepared",
                      "scheduled-on-platform",
                      "uncertain",
                    ].includes(job.state) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void command({ action: "cancel-job", jobId: job.id })}
                      >
                        {l("cancel", "Cancel")}
                      </Button>
                    )}
                    {!job.submittedAt &&
                      ["missed", "failed", "needs-login"].includes(job.state) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void command({ action: "retry-job", jobId: job.id })}
                        >
                          {l("reviewRetry", "Review and retry")}
                        </Button>
                      )}
                  </div>
                </article>
              ))}
            </section>
          )}
          {tab === "authorizations" && (
            <Authorizations
              state={state}
              command={command}
              busy={busy}
              {...(initialWorkflowId ? { initialWorkflowId } : {})}
            />
          )}
          {tab === "resources" && resources}
        </>
      )}
    </main>
  );
}

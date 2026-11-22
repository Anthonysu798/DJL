import { ensureMultiPostSchema } from "./schema";
import { cropMedia, importMultiPostMedia, multiPostAttachments, quickPostMedia } from "./media";
import { describeSkipped, planQuickPost, quickPostContent } from "./quickPost";
import { stat } from "node:fs/promises";
import { normalizeContent } from "@djl/multipost";
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type {
  MultiPostAccount,
  MultiPostActor,
  MultiPostBrowserRuntime,
  MultiPostCapability,
  MultiPostCommand,
  MultiPostDraft,
  MultiPostEvidence,
  MultiPostGrant,
  MultiPostJob,
  MultiPostNotice,
  MultiPostQuickPost,
  MultiPostQuickPostResult,
  MultiPostScope,
  MultiPostState,
  MultiPostWorkflow,
} from "@djl/contracts";
import { MULTIPOST_CROP_RATIO } from "@djl/contracts";

type RecordKind = "account" | "draft" | "job" | "workflow" | "grant";
type Stored = MultiPostAccount | MultiPostDraft | MultiPostJob | MultiPostWorkflow | MultiPostGrant;
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function timezone(value: string) {
  assert(typeof value === "string", "Timezone is required");
  Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions();
}
const clockDay = (date: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const identityKey = (value: { provider: string; accountId: string }) =>
  `${value.provider}:${value.accountId}`;

function assertPublicationEvidence(job: MultiPostJob, evidence: MultiPostEvidence) {
  if (evidence.state !== "published") return;
  let verified = false;
  if (evidence.postUrl) {
    try {
      const url = new URL(evidence.postUrl);
      verified =
        url.protocol === "https:" ||
        (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    } catch {}
  } else {
    verified = Boolean(
      job.submittedAt &&
      job.adapterId === "DYNAMIC_INSTAGRAM" &&
      evidence.providerConfirmation === "instagram-post-shared",
    );
  }
  assert(verified, "Publication requires real provider evidence");
}

/** One service owns consent and durable state for UI, agents and the scheduler. */
const AUTOPILOT_UNDO_MS = 10_000;
const RETRY_AFTER_MS = 30_000;
/** Trouble that usually passes by itself: the internet dropped, or the desktop could not be reached. */
const connectionLost = (message: string) =>
  /ERR_(NETWORK|INTERNET|CONNECTION|NAME_NOT_RESOLVED|TIMED_OUT|ADDRESS_UNREACHABLE)|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(
    message,
  );
const handle = (username: string) => (/^[\w.-]+$/.test(username) ? `@${username}` : username);
const neverSignedIn = (account: MultiPostAccount) =>
  !account.identity && account.status !== "connected" && !account.homeUrl;
/** The moments worth interrupting someone for: it went out, it did not, or it is waiting on them. */
function noticeKind(job: MultiPostJob): MultiPostNotice["kind"] | null {
  if (job.state === "published" || job.state === "delivered") return "posted";
  if (job.state === "failed") return "failed";
  if (["needs-login", "missed", "uncertain"].includes(job.state)) return "needs-you";
  return job.state === "prepared" && job.evidence?.requiresManual ? "needs-you" : null;
}
export class MultiPostService {
  private readonly aborts = new Map<string, AbortController>();
  private readonly busyAccounts = new Set<string>();
  private ticking = false;
  private startedAt = 0;
  private lastTick = 0;
  private missedIntervals: { start: number; end: number }[] = [];
  constructor(
    private readonly sql: SqlClient,
    private readonly runtime: MultiPostBrowserRuntime,
    private readonly capabilities: MultiPostCapability[],
    private readonly now: () => Date = () => new Date(),
  ) {}
  async initialize() {
    this.startedAt = this.now().getTime();
    this.lastTick = this.startedAt;
    await Effect.runPromise(ensureMultiPostSchema(this.sql));
    const interrupted = await Effect.runPromise(
      this.sql<{
        body: string;
      }>`SELECT body FROM multipost_records WHERE kind='job' AND json_extract(body,'$.state') IN ('preparing','prepared','submitting')`,
    );
    for (const row of interrupted) {
      const job = JSON.parse(row.body) as MultiPostJob;
      await this.write("job", {
        ...job,
        state: job.submittedAt ? "uncertain" : "missed",
        error: "Execution interrupted; inspect before retrying.",
        updatedAt: this.time(),
      });
    }
  }
  private time() {
    return this.now().toISOString();
  }
  private async read<T extends Stored>(
    kind: RecordKind,
    id: string,
    workspaceId: string,
  ): Promise<T> {
    const rows = await Effect.runPromise(
      this.sql<{
        body: string;
      }>`SELECT body FROM multipost_records WHERE kind=${kind} AND id=${id} AND workspace_id=${workspaceId}`,
    );
    assert(rows[0], "MultiPost item is missing from this workspace");
    return JSON.parse(rows[0].body) as T;
  }
  private async list<T extends Stored>(kind: RecordKind, workspaceId: string): Promise<T[]> {
    const rows = await Effect.runPromise(
      this.sql<{
        body: string;
      }>`SELECT body FROM multipost_records WHERE kind=${kind} AND workspace_id=${workspaceId} ORDER BY rowid DESC`,
    );
    return rows.map((row) => JSON.parse(row.body) as T);
  }
  private async write<T extends Stored>(kind: RecordKind, value: T, expected?: number) {
    if (expected !== undefined) {
      const rows = await Effect.runPromise(
        this
          .sql`UPDATE multipost_records SET body=${JSON.stringify(value)},version=version+1 WHERE kind=${kind} AND id=${value.id} AND workspace_id=${value.workspaceId} AND json_extract(body,'$.revision')=${expected} RETURNING id`,
      );
      assert(rows.length, "Item changed; reload its current revision");
    } else
      await Effect.runPromise(
        this
          .sql`INSERT INTO multipost_records(kind,id,workspace_id,body) VALUES (${kind},${value.id},${value.workspaceId},${JSON.stringify(value)}) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,version=multipost_records.version+1 WHERE multipost_records.workspace_id=excluded.workspace_id`,
      );
    return value;
  }
  private async draft(scope: MultiPostScope, id: string, revision: number) {
    const draft = await this.read<MultiPostDraft>("draft", id, scope.workspaceId);
    assert(draft.threadId === scope.threadId, "Draft belongs to another conversation");
    assert(draft.revision === revision, "Draft revision changed; review again");
    return draft;
  }
  private async validateTargets(
    scope: MultiPostScope,
    draft: Pick<MultiPostDraft, "kind" | "targets" | "data" | "publicationMode">,
  ) {
    assert(
      Array.isArray(draft.targets) && draft.targets.length > 0 && draft.targets.length <= 100,
      "Select between 1 and 100 publishing targets",
    );
    const unique = new Set<string>();
    for (const target of draft.targets) {
      const adapter = this.capabilities.find((x) => x.id === target.adapterId);
      assert(adapter && adapter.kind === draft.kind, "Adapter does not support this content type");
      const nativeTime = target.overrides?.scheduledPublishTime ?? draft.data.scheduledPublishTime;
      if (nativeTime !== undefined) {
        assert(
          draft.publicationMode === "now",
          "Choose local scheduling or platform-native scheduling, not both",
        );
        assert(
          Number.isFinite(nativeTime) && nativeTime > this.now().getTime(),
          "Choose a future platform-native schedule",
        );
        assert(
          adapter.supportsNativeScheduling,
          "A selected platform does not support native scheduling",
        );
      }
      const account = await this.read<MultiPostAccount>(
        "account",
        target.accountId,
        scope.workspaceId,
      );
      assert(
        account.platformKey === adapter.platformKey,
        "Account does not match the selected platform",
      );
      const key = `${target.accountId}:${target.adapterId}`;
      assert(!unique.has(key), "Duplicate publishing target");
      unique.add(key);
    }
  }
  /** Unattended posts may only go where the user bound the account, never to an agent-chosen URL. */
  private async assertBoundDestinations(scope: MultiPostScope, draft: MultiPostDraft) {
    for (const target of draft.targets) {
      const custom = [
        ...(Array.isArray(target.extraConfig?.urls) ? target.extraConfig.urls : []),
        ...(Array.isArray(target.extraConfig?.customInjectUrls)
          ? target.extraConfig.customInjectUrls
          : []),
      ];
      if (custom.length) {
        const account = await this.read<MultiPostAccount>(
          "account",
          target.accountId,
          scope.workspaceId,
        );
        assert(
          account.homeUrl && custom.every((value) => value === account.homeUrl),
          "Custom destinations need an explicitly bound account URL before unattended publishing",
        );
      }
    }
  }
  private autopilotOn(account: MultiPostAccount) {
    return Boolean(
      account.autopilot &&
      account.identity &&
      account.status === "connected" &&
      Date.parse(account.autopilot.expiresAt) > this.now().getTime(),
    );
  }
  /** Accounts a draft targets that the user has not put on autopilot. */
  private async autopilotGaps(scope: MultiPostScope, draft: MultiPostDraft) {
    const gaps: MultiPostAccount[] = [];
    for (const accountId of new Set(draft.targets.map((target) => target.accountId))) {
      const account = await this.read<MultiPostAccount>("account", accountId, scope.workspaceId);
      if (!this.autopilotOn(account)) gaps.push(account);
    }
    return gaps;
  }
  private async stopAutopilotJobs(scope: MultiPostScope, accountId: string) {
    for (const job of await this.list<MultiPostJob>("job", scope.workspaceId))
      if (job.autopilot && job.accountId === accountId) {
        this.aborts.get(job.id)?.abort();
        if (!job.submittedAt && !["cancelled", "failed", "missed"].includes(job.state))
          await this.write("job", {
            ...job,
            state: "cancelled",
            error: "Autopilot was switched off.",
            updatedAt: this.time(),
          });
      }
  }
  private async validGrant(scope: MultiPostScope, draft: MultiPostDraft, grantId: string) {
    const grant = await this.read<MultiPostGrant>("grant", grantId, scope.workspaceId);
    assert(
      !grant.revokedAt && Date.parse(grant.expiresAt) > this.now().getTime(),
      "Publishing authorization expired or was revoked",
    );
    const workflow = await this.read<MultiPostWorkflow>(
      "workflow",
      grant.workflowId,
      scope.workspaceId,
    );
    assert(
      workflow.revision === grant.workflowRevision &&
        draft.workflowId === workflow.id &&
        draft.workflowRevision === workflow.revision,
      "Workflow revision changed; request authorization again",
    );
    await this.assertBoundDestinations(scope, draft);
    assert(
      grant.kinds.includes(draft.kind) &&
        draft.targets.every((x) => grant.accountIds.includes(x.accountId)),
      "Publishing target is outside the authorization",
    );
    return grant;
  }
  async command(
    scope: MultiPostScope,
    command: MultiPostCommand,
    actor: MultiPostActor,
  ): Promise<unknown> {
    assert(
      scope.workspaceId && scope.threadId && scope.authorizedRoot,
      "Missing trusted workspace scope",
    );
    assert(command && typeof command.action === "string", "Invalid MultiPost command");
    switch (command.action) {
      case "state":
        return {
          accounts: await this.list("account", scope.workspaceId),
          drafts: await this.list("draft", scope.workspaceId),
          jobs: await this.list("job", scope.workspaceId),
          workflows: await this.list("workflow", scope.workspaceId),
          grants: await this.list("grant", scope.workspaceId),
          capabilities: this.capabilities,
          runtimeAvailable: await this.runtime.available(),
          currentTime: this.time(),
          localTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          attachments: await Promise.all(
            (await multiPostAttachments(scope)).map(async (file) => ({
              path: `Attachments/${path.basename(file)}`,
              name: path.basename(file),
              bytes: (await stat(file)).size,
            })),
          ),
        } satisfies MultiPostState;
      case "create-account": {
        assert(
          typeof command.label === "string" &&
            command.label.trim().length > 0 &&
            command.label.length <= 100,
          "Account label is required",
        );
        assert(
          this.capabilities.some((x) => x.platformKey === command.platformKey),
          "Unknown platform",
        );
        if (command.homeUrl) {
          assert(actor === "ui", "Only the user UI can bind custom destinations");
          const url = new URL(command.homeUrl);
          assert(
            url.protocol === "https:" ||
              (url.protocol === "http:" &&
                ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)),
            "Use HTTPS or a local loopback destination",
          );
          assert(
            !url.username && !url.password,
            "Do not embed login credentials in destination URLs",
          );
        }
        if (["webhook", "wordpress"].includes(command.platformKey))
          assert(command.homeUrl, "Configure this destination in the Accounts UI");
        // A sign-in that was never finished is picked up again, not left behind as an empty account.
        const unfinished = command.homeUrl
          ? undefined
          : (await this.list<MultiPostAccount>("account", scope.workspaceId)).find(
              (x) => x.platformKey === command.platformKey && neverSignedIn(x),
            );
        if (unfinished) return unfinished;
        return this.write("account", {
          ...(command.homeUrl ? { homeUrl: command.homeUrl } : {}),
          id: randomUUID(),
          workspaceId: scope.workspaceId,
          platformKey: command.platformKey,
          label: command.label.trim(),
          status: "disconnected",
          identity: null,
          createdAt: this.time(),
        } satisfies MultiPostAccount);
      }
      case "connect-account": {
        const account = await this.read<MultiPostAccount>(
          "account",
          command.accountId,
          scope.workspaceId,
        );
        await this.runtime.connect(scope, account);
        return this.write("account", { ...account, status: "needs-login" });
      }
      case "verify-account": {
        assert(actor === "ui", "Only the user UI can bind a platform identity");
        const account = await this.read<MultiPostAccount>(
          "account",
          command.accountId,
          scope.workspaceId,
        );
        const identity = await this.runtime.identity(scope, account);
        assert(
          identity?.accountId,
          "Platform identity could not be verified; finish login in the account window",
        );
        const changed = account.identity && identityKey(account.identity) !== identityKey(identity);
        if (changed) {
          for (const grant of await this.list<MultiPostGrant>("grant", scope.workspaceId))
            if (grant.accountIds.includes(account.id) && !grant.revokedAt)
              await this.write("grant", { ...grant, revokedAt: this.time() });
        }
        if (!account.identity) {
          const used = new Set(
            (await this.list<MultiPostJob>("job", scope.workspaceId)).map((job) => job.accountId),
          );
          for (const other of await this.list<MultiPostAccount>("account", scope.workspaceId))
            if (
              other.id !== account.id &&
              other.platformKey === account.platformKey &&
              neverSignedIn(other) &&
              !used.has(other.id)
            )
              await this.command(scope, { action: "remove-account", accountId: other.id }, "ui");
        }
        return this.write("account", {
          ...account,
          // People know their accounts by handle, not by "Instagram 3".
          ...(!account.identity && identity.username ? { label: handle(identity.username) } : {}),
          identity,
          status: "connected",
          checkedAt: this.time(),
          ...(changed ? { autopilot: null } : {}),
        });
      }
      case "remove-account": {
        assert(actor === "ui", "Only the user can remove accounts");
        await this.command(
          scope,
          { action: "disconnect-account", accountId: command.accountId },
          "ui",
        );
        await Effect.runPromise(
          this
            .sql`DELETE FROM multipost_records WHERE kind='account' AND id=${command.accountId} AND workspace_id=${scope.workspaceId}`,
        );
        return { removed: true };
      }
      case "check-accounts": {
        assert(actor === "ui", "Only the user UI checks accounts");
        const accounts = await this.list<MultiPostAccount>("account", scope.workspaceId);
        // Accounts from before handles were used: rename the numbered ones, drop empty leftovers.
        const used = new Set(
          (await this.list<MultiPostJob>("job", scope.workspaceId)).map((job) => job.accountId),
        );
        for (const account of accounts) {
          const plain = account.label.replace(/ \d+$/, "").toLowerCase();
          const numbered = this.capabilities.some(
            (x) =>
              x.platformKey === account.platformKey &&
              [x.displayName.toLowerCase(), x.platformKey].includes(plain),
          );
          if (account.identity?.username && numbered)
            await this.write("account", { ...account, label: handle(account.identity.username) });
          else if (
            neverSignedIn(account) &&
            !used.has(account.id) &&
            accounts.some((x) => x.platformKey === account.platformKey && x.identity)
          )
            await this.command(scope, { action: "remove-account", accountId: account.id }, "ui");
        }
        for (const account of await this.list<MultiPostAccount>("account", scope.workspaceId)) {
          if (
            account.status !== "connected" ||
            !account.identity ||
            this.busyAccounts.has(account.id) ||
            this.now().getTime() - Date.parse(account.checkedAt ?? "1970-01-01") < 6 * 3_600_000 ||
            !this.capabilities.some(
              (x) => x.platformKey === account.platformKey && x.identitySupported,
            )
          )
            continue;
          // A check that cannot run says nothing about the account, so it changes nothing.
          const identity = await this.runtime.identity(scope, account).catch(() => undefined);
          if (identity === undefined) continue;
          const fresh = await this.read<MultiPostAccount>("account", account.id, scope.workspaceId);
          if (fresh.status !== "connected") continue;
          await this.write("account", {
            ...fresh,
            checkedAt: this.time(),
            ...(identity && identityKey(identity) === identityKey(account.identity)
              ? {}
              : { status: "needs-login" as const }),
          });
        }
        // A platform can confirm a share before it shows where the post is; look again for a day.
        if (this.runtime.postLink) {
          const recent = (await this.list<MultiPostJob>("job", scope.workspaceId))
            .filter(
              (job) =>
                job.state === "published" &&
                job.submittedAt &&
                job.evidence &&
                !job.evidence.postUrl &&
                this.now().getTime() - Date.parse(job.submittedAt) < 24 * 3_600_000 &&
                !this.busyAccounts.has(job.accountId),
            )
            .toSorted((a, b) => b.submittedAt!.localeCompare(a.submittedAt!))
            .slice(0, 2);
          for (const job of recent) await this.findLink(scope, job);
        }
        return this.list<MultiPostAccount>("account", scope.workspaceId);
      }
      case "disconnect-account": {
        assert(actor === "ui", "Only the user UI can disconnect accounts");
        const account = await this.read<MultiPostAccount>(
          "account",
          command.accountId,
          scope.workspaceId,
        );
        // Persist the stop before browser cleanup, which can take time.
        const disconnected = await this.write("account", {
          ...account,
          identity: null,
          autopilot: null,
          status: "disconnected",
        });
        for (const grant of await this.list<MultiPostGrant>("grant", scope.workspaceId))
          if (grant.accountIds.includes(account.id) && !grant.revokedAt)
            await this.write("grant", { ...grant, revokedAt: this.time() });
        for (const job of await this.list<MultiPostJob>("job", scope.workspaceId))
          if (
            job.accountId === account.id &&
            !["published", "delivered", "cancelled"].includes(job.state)
          )
            await this.command(scope, { action: "cancel-job", jobId: job.id }, "ui");
        await this.runtime.disconnect(scope, account);
        return disconnected;
      }
      case "set-autopilot": {
        assert(actor === "ui", "Only the user can switch Autopilot on or off");
        const account = await this.read<MultiPostAccount>(
          "account",
          command.accountId,
          scope.workspaceId,
        );
        if (!command.enabled) {
          const off = await this.write("account", { ...account, autopilot: null });
          await this.stopAutopilotJobs(scope, account.id);
          return off;
        }
        assert(
          account.identity && account.status === "connected",
          "Sign in to this account before switching on Autopilot",
        );
        const dailyLimit = command.dailyLimit ?? 5;
        assert(
          Number.isInteger(dailyLimit) && dailyLimit >= 1 && dailyLimit <= 50,
          "Choose between 1 and 50 posts a day",
        );
        return this.write("account", {
          ...account,
          autopilot: {
            dailyLimit,
            expiresAt: new Date(this.now().getTime() + 30 * 86_400_000).toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        });
      }
      case "quick-post":
        return this.quickPost(scope, command.post, actor);
      case "save-draft": {
        const input = command.draft;
        assert(
          input && typeof input.data?.title === "string" && input.data.title.length <= 500,
          "Content title is required (up to 500 characters)",
        );
        assert(JSON.stringify(input.data).length <= 1024 * 1024, "Draft content is too large");
        timezone(input.timezone);
        await this.validateTargets(scope, input);
        if (input.publicationMode === "scheduled")
          assert(
            input.scheduledAt &&
              /(Z|[+-]\d{2}:\d{2})$/.test(input.scheduledAt) &&
              Number.isFinite(Date.parse(input.scheduledAt)) &&
              Date.parse(input.scheduledAt) > this.now().getTime(),
            "Choose a future scheduled time with an explicit timezone offset",
          );
        assert(["now", "scheduled"].includes(input.publicationMode), "Invalid publication mode");
        const old = input.id ? await this.draft(scope, input.id, input.revision!) : null;
        const value: MultiPostDraft = {
          id: old?.id ?? randomUUID(),
          workspaceId: scope.workspaceId,
          threadId: scope.threadId,
          revision: (old?.revision ?? 0) + 1,
          kind: input.kind,
          data: normalizeContent(
            input.kind,
            structuredClone(
              old && !input.replaceContent ? { ...old.data, ...input.data } : input.data,
            ),
          ),
          targets: structuredClone(
            input.targets.map((target) => {
              const previous = old?.targets.find(
                (x) => x.accountId === target.accountId && x.adapterId === target.adapterId,
              );
              return {
                ...target,
                ...(previous?.extraConfig || target.extraConfig
                  ? { extraConfig: { ...previous?.extraConfig, ...target.extraConfig } }
                  : {}),
              };
            }),
          ),
          approvedRevision: null,
          publicationMode: input.publicationMode,
          scheduledAt:
            input.publicationMode === "scheduled"
              ? new Date(input.scheduledAt!).toISOString()
              : null,
          timezone: input.timezone,
          createdAt: old?.createdAt ?? this.time(),
          updatedAt: this.time(),
          ...(input.workflowId
            ? { workflowId: input.workflowId, workflowRevision: input.workflowRevision! }
            : {}),
        };
        const saved = await this.write("draft", value, old?.revision);
        if (old)
          for (const job of await this.list<MultiPostJob>("job", scope.workspaceId))
            if (job.draftId === old.id && job.revision !== value.revision)
              this.aborts.get(job.id)?.abort();
        return saved;
      }
      case "review-draft":
        return this.draft(scope, command.draftId, command.revision);
      case "approve-draft": {
        assert(actor === "ui", "Only the user UI can approve publication");
        const draft = await this.draft(scope, command.draftId, command.revision);
        await this.validateTargets(scope, draft);
        return this.write(
          "draft",
          { ...draft, approvedRevision: draft.revision, updatedAt: this.time() },
          draft.revision,
        );
      }
      case "submit-draft": {
        const draft = await this.draft(scope, command.draftId, command.revision);
        const autopilot = !command.grantId && draft.approvedRevision !== draft.revision;
        if (command.grantId) await this.validGrant(scope, draft, command.grantId);
        else if (autopilot) {
          const gaps = await this.autopilotGaps(scope, draft);
          assert(
            !gaps.length,
            `Not approved yet: tap Post on the preview card, or switch on Autopilot for ${gaps.map((x) => x.label).join(", ")} in MultiPost Accounts`,
          );
          await this.assertBoundDestinations(scope, draft);
        }
        await this.validateTargets(scope, draft);
        const jobs: MultiPostJob[] = [];
        const expanded = draft.targets.flatMap((target) => {
          const field =
            Array.isArray(target.extraConfig?.customInjectUrls) &&
            target.extraConfig.customInjectUrls.length
              ? "customInjectUrls"
              : Array.isArray(target.extraConfig?.urls) && target.extraConfig.urls.length
                ? "urls"
                : null;
          return field
            ? // oxlint-disable-next-line oxc/no-map-spread -- Each destination keeps an immutable configuration snapshot.
              (target.extraConfig![field] as string[]).map((url) => ({
                ...target,
                extraConfig: { ...target.extraConfig, [field]: [url] },
              }))
            : [target];
        });
        assert(expanded.length <= 100, "Select no more than 100 destinations per batch");
        for (const target of expanded) {
          const id = createHash("sha256")
            .update(
              `${scope.workspaceId}:${draft.id}:${draft.revision}:${target.accountId}:${target.adapterId}:${JSON.stringify(target.extraConfig?.customInjectUrls ?? target.extraConfig?.urls ?? [])}`,
            )
            .digest("hex");
          const job: MultiPostJob = {
            id,
            workspaceId: scope.workspaceId,
            threadId: scope.threadId,
            draftId: draft.id,
            revision: draft.revision,
            accountId: target.accountId,
            adapterId: target.adapterId,
            snapshot: structuredClone(draft),
            target: structuredClone(target),
            state: "queued",
            // Nobody pressed Post for an Autopilot job, so it waits a moment and can be cancelled.
            dueAt:
              draft.scheduledAt ??
              (autopilot
                ? new Date(this.now().getTime() + AUTOPILOT_UNDO_MS).toISOString()
                : this.time()),
            submittedAt: null,
            grantId: command.grantId ?? null,
            ...(autopilot ? { autopilot: true } : {}),
            evidence: null,
            error: null,
            createdAt: this.time(),
            updatedAt: this.time(),
          };
          await Effect.runPromise(
            this
              .sql`INSERT INTO multipost_records(kind,id,workspace_id,body) VALUES ('job',${id},${scope.workspaceId},${JSON.stringify({ ...job, authorizedRoot: scope.authorizedRoot, ...(scope.mediaRoot ? { mediaRoot: scope.mediaRoot } : {}) })}) ON CONFLICT DO NOTHING`,
          );
          jobs.push(await this.read("job", id, scope.workspaceId));
        }
        return jobs;
      }
      case "open-job":
      case "verify-job":
      case "close-job": {
        const job = await this.read<MultiPostJob>("job", command.jobId, scope.workspaceId);
        const account = await this.read<MultiPostAccount>(
          "account",
          job.accountId,
          scope.workspaceId,
        );
        const context = { scope, account, job };
        if (command.action === "open-job") {
          if (this.runtime.open) await this.runtime.open(context);
          else await this.runtime.connect(scope, account);
          return { opened: true };
        }
        if (command.action === "close-job") {
          assert(actor === "ui", "Only the user UI closes execution pages");
          await this.runtime.close?.(context);
          return { closed: true };
        }
        if (["published", "delivered"].includes(job.state) && job.evidence) return job;
        const evidence = await this.runtime.verify(context);
        assertPublicationEvidence(job, evidence);
        const verifiedJob = {
          ...job,
          evidence,
          state: evidence.state,
          updatedAt: this.time(),
        };
        // A browser probe may finish after the queue or another probe advanced this job.
        // Compare the stored snapshot atomically so it cannot erase a submission fence.
        await Effect.runPromise(
          this
            .sql`UPDATE multipost_records SET body=${JSON.stringify(verifiedJob)},version=version+1 WHERE kind='job' AND id=${job.id} AND workspace_id=${scope.workspaceId} AND body=${JSON.stringify(job)}`,
        );
        return this.read<MultiPostJob>("job", job.id, scope.workspaceId);
      }
      case "cancel-job": {
        const job = await this.read<MultiPostJob>("job", command.jobId, scope.workspaceId);
        this.aborts.get(job.id)?.abort();
        if (job.submittedAt) {
          const account = await this.read<MultiPostAccount>(
            "account",
            job.accountId,
            scope.workspaceId,
          );
          const evidence = await this.runtime.cancel({ scope, account, job });
          return this.write("job", {
            ...job,
            evidence,
            state: evidence.state === "cancelled" ? "cancelled" : job.state,
            error:
              evidence.state === "cancelled"
                ? null
                : "Cancellation is not confirmed; inspect the platform.",
          });
        }
        return this.write("job", { ...job, state: "cancelled", updatedAt: this.time() });
      }
      case "reschedule-job": {
        assert(actor === "ui", "Only the user can move a scheduled post");
        const job = await this.read<MultiPostJob>("job", command.jobId, scope.workspaceId);
        assert(
          job.state === "queued" && !job.submittedAt && job.snapshot.scheduledAt,
          "Only a post that is still scheduled can be moved",
        );
        const when = Date.parse(command.scheduledAt);
        assert(
          Number.isFinite(when) &&
            when > this.now().getTime() &&
            when < this.now().getTime() + 366 * 86_400_000,
          "Pick a time in the future",
        );
        const scheduledAt = new Date(when).toISOString();
        return this.write("job", {
          ...job,
          dueAt: scheduledAt,
          snapshot: { ...job.snapshot, scheduledAt },
          updatedAt: this.time(),
        });
      }
      case "retry-job": {
        const job = await this.read<MultiPostJob>("job", command.jobId, scope.workspaceId);
        assert(
          !job.submittedAt && ["missed", "failed", "needs-login"].includes(job.state),
          "Submitted or uncertain tasks require verification, not retry",
        );
        assert(actor === "ui", "The user must confirm retrying a missed task");
        return this.write("job", {
          ...job,
          state: "queued",
          dueAt: this.time(),
          error: null,
          updatedAt: this.time(),
        });
      }
      case "save-workflow": {
        const input = command.workflow;
        assert(
          input && typeof input.name === "string" && input.name.trim() && input.name.length <= 200,
          "Workflow name is required",
        );
        assert(
          Array.isArray(input.kinds) &&
            input.kinds.length > 0 &&
            input.kinds.every((k) => ["dynamic", "article", "video", "podcast"].includes(k)),
          "Select content types",
        );
        assert(
          Array.isArray(input.accountIds) && input.accountIds.length > 0,
          "Select workflow accounts",
        );
        for (const id of input.accountIds) await this.read("account", id, scope.workspaceId);
        const old = input.id
          ? await this.read<MultiPostWorkflow>("workflow", input.id, scope.workspaceId)
          : null;
        assert(!old || old.revision === input.revision, "Workflow revision changed");
        return this.write(
          "workflow",
          {
            ...input,
            id: old?.id ?? randomUUID(),
            workspaceId: scope.workspaceId,
            revision: (old?.revision ?? 0) + 1,
          },
          old?.revision,
        );
      }
      case "create-grant": {
        assert(actor === "ui", "Only the user UI can grant publishing authorization");
        const input = command.grant;
        assert(
          input && Date.parse(input.expiresAt) > this.now().getTime(),
          "Authorization must expire in the future",
        );
        assert(
          Number.isInteger(input.dailyLimit) && input.dailyLimit > 0 && input.dailyLimit <= 1000,
          "Daily publishing limit must be 1–1000",
        );
        timezone(input.timezone);
        const workflow = await this.read<MultiPostWorkflow>(
          "workflow",
          input.workflowId,
          scope.workspaceId,
        );
        assert(workflow.revision === input.workflowRevision, "Workflow revision changed");
        assert(
          input.accountIds.length > 0 &&
            input.accountIds.every((x) => workflow.accountIds.includes(x)) &&
            input.kinds.length > 0 &&
            input.kinds.every((x) => workflow.kinds.includes(x)),
          "Grant exceeds workflow scope",
        );
        for (const id of input.accountIds) {
          const account = await this.read<MultiPostAccount>("account", id, scope.workspaceId);
          assert(
            account.identity && account.status === "connected",
            "Verify every authorized account first",
          );
        }
        return this.write("grant", {
          ...input,
          id: randomUUID(),
          workspaceId: scope.workspaceId,
          createdAt: this.time(),
          revokedAt: null,
        } satisfies MultiPostGrant);
      }
      case "revoke-grant": {
        const grant = await this.read<MultiPostGrant>("grant", command.grantId, scope.workspaceId);
        const revoked = await this.write("grant", { ...grant, revokedAt: this.time() });
        for (const job of await this.list<MultiPostJob>("job", scope.workspaceId))
          if (job.grantId === grant.id) {
            this.aborts.get(job.id)?.abort();
            if (!job.submittedAt)
              await this.write("job", {
                ...job,
                state: "cancelled",
                error: "Publishing authorization was revoked.",
                updatedAt: this.time(),
              });
          }
        return revoked;
      }
      case "request-authorization":
        return {
          requiresUserAction: true,
          view: "authorizations",
          uiPath: `#/social/${encodeURIComponent(scope.threadId)}?multipostView=authorizations${command.workflowId ? `&workflowId=${encodeURIComponent(command.workflowId)}` : ""}`,
          workflowId: command.workflowId ?? null,
        };
      case "import-media":
        return importMultiPostMedia(scope, command.paths);
      case "inspect-media": {
        assert(
          Array.isArray(command.paths) && command.paths.length <= 20,
          "Select at most 20 files",
        );
        const root = await realpath(scope.authorizedRoot);
        const { stat } = await import("node:fs/promises");
        return Promise.all(
          command.paths.map(async (input) => {
            const full = await realpath(path.resolve(root, input));
            assert(
              full === root || full.startsWith(root + path.sep),
              "Media is outside the authorized workspace",
            );
            const info = await stat(full);
            assert(info.isFile(), "Media must be a file");
            return { name: path.basename(full), bytes: info.size, path: path.relative(root, full) };
          }),
        );
      }
      default:
        throw new Error("Unknown MultiPost command");
    }
  }
  /** One call from "here is my post" to queued: used by the simple composer and by agents. */
  private async quickPost(
    scope: MultiPostScope,
    post: MultiPostQuickPost,
    actor: MultiPostActor,
  ): Promise<MultiPostQuickPostResult> {
    assert(post && typeof post.text === "string", "Write something to post");
    const text = post.text.trim();
    const files = await quickPostMedia(scope, post.media ?? []);
    assert(text || files.length, "Write something or add a photo or video to post");
    const all = (await this.list<MultiPostAccount>("account", scope.workspaceId)).toReversed();
    const accounts = post.accountIds?.length
      ? post.accountIds.map((id) => {
          const account = all.find((x) => x.id === id);
          assert(account, "That account is not in this workspace");
          return account;
        })
      : all.filter(
          (account) =>
            account.status === "connected" ||
            (account.status === "needs-login" &&
              !this.capabilities.some(
                (x) => x.platformKey === account.platformKey && x.identitySupported,
              )),
        );
    assert(accounts.length, "Connect an account first: open MultiPost, then Accounts");
    const { targets, skipped } = planQuickPost(this.capabilities, accounts, files);
    assert(
      targets.dynamic.length + targets.video.length,
      `None of the chosen accounts can take this post: ${describeSkipped(skipped)}`,
    );
    const images = files.filter((file) => file.type?.startsWith("image/"));
    for (const target of targets.dynamic) {
      const platformKey = accounts.find((x) => x.id === target.accountId)?.platformKey ?? "";
      const ratio = MULTIPOST_CROP_RATIO[platformKey];
      if (!ratio || !images.length) continue;
      const cropped = await Promise.all(images.map((file) => cropMedia(scope, file, ratio)));
      if (cropped.some((file, i) => file !== images[i])) target.overrides = { images: cropped };
    }
    const drafts: MultiPostDraft[] = [];
    const jobs: MultiPostJob[] = [];
    const waiting: string[] = [];
    for (const kind of ["dynamic", "video"] as const) {
      if (!targets[kind].length) continue;
      const draft = (await this.command(
        scope,
        {
          action: "save-draft",
          draft: {
            kind,
            data: quickPostContent(kind, text, post.title?.trim() || undefined, files),
            targets: targets[kind],
            publicationMode: post.scheduledAt ? "scheduled" : "now",
            scheduledAt: post.scheduledAt ?? null,
            timezone: post.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
        actor,
      )) as MultiPostDraft;
      const submit = { draftId: draft.id, revision: draft.revision };
      const gaps = actor === "ui" ? [] : await this.autopilotGaps(scope, draft);
      if (actor === "ui") await this.command(scope, { action: "approve-draft", ...submit }, actor);
      if (gaps.length) waiting.push(...gaps.map((account) => account.label));
      else
        jobs.push(
          ...((await this.command(
            scope,
            { action: "submit-draft", ...submit },
            actor,
          )) as MultiPostJob[]),
        );
      drafts.push(await this.read<MultiPostDraft>("draft", draft.id, scope.workspaceId));
    }
    const label = (id: string) => accounts.find((account) => account.id === id)?.label ?? id;
    const message = [
      jobs.length &&
        `${post.scheduledAt ? "Scheduled" : "Queued"} for ${[...new Set(jobs.map((job) => label(job.accountId)))].join(", ")}. Queued is not published: read djl_multipost_jobs for the real result.`,
      waiting.length &&
        `Saved but not posted: Autopilot is off for ${[...new Set(waiting)].join(", ")}, so the user must tap Post on the preview card in this chat, or switch Autopilot on in MultiPost Accounts.`,
      skipped.length && `Skipped: ${describeSkipped(skipped)}.`,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      drafts,
      jobs,
      posted: jobs.length > 0,
      needsApproval: waiting.length > 0,
      skipped,
      message,
    };
  }
  /** A platform can confirm a share without saying where the post is; the desktop goes and looks. */
  private async findLink(scope: MultiPostScope, job: MultiPostJob) {
    if (!this.runtime.postLink) return;
    const account = await this.read<MultiPostAccount>(
      "account",
      job.accountId,
      job.workspaceId,
    ).catch(() => null);
    if (account?.status !== "connected") return;
    const postUrl = await this.runtime.postLink({ scope, account, job }).catch(() => null);
    if (!postUrl || !URL.canParse(postUrl) || new URL(postUrl).protocol !== "https:") return;
    const fresh = await this.read<MultiPostJob>("job", job.id, job.workspaceId);
    if (fresh.state === "published" && fresh.evidence && !fresh.evidence.postUrl)
      await this.write("job", { ...fresh, evidence: { ...fresh.evidence, postUrl } });
  }
  async runDue() {
    const tick = this.now().getTime();
    if (tick - this.lastTick > 30_000)
      this.missedIntervals.push({ start: this.lastTick, end: tick });
    this.lastTick = tick;
    if (this.ticking) return;
    this.ticking = true;
    try {
      const rows = await Effect.runPromise(
        this.sql<{
          body: string;
        }>`SELECT body FROM multipost_records WHERE kind='job' AND json_extract(body,'$.state')='queued' AND json_extract(body,'$.dueAt')<=${this.time()} ORDER BY json_extract(body,'$.dueAt'),rowid LIMIT 3`,
      );
      await Promise.all(
        rows.map(async (row) => {
          const job = JSON.parse(row.body) as MultiPostJob & {
            authorizedRoot: string;
            mediaRoot?: string;
          };
          if (this.busyAccounts.has(job.accountId)) return;
          this.busyAccounts.add(job.accountId);
          try {
            await this.execute(job);
          } finally {
            this.busyAccounts.delete(job.accountId);
          }
        }),
      );
    } finally {
      this.ticking = false;
    }
  }
  private async execute(initial: MultiPostJob & { authorizedRoot: string; mediaRoot?: string }) {
    let job: MultiPostJob = initial;
    const scope: MultiPostScope = {
      workspaceId: job.workspaceId,
      threadId: job.threadId,
      authorizedRoot: initial.authorizedRoot,
      ...(initial.mediaRoot ? { mediaRoot: initial.mediaRoot } : {}),
    };
    const abort = new AbortController();
    this.aborts.set(job.id, abort);
    const save = async (patch: Partial<MultiPostJob>) => {
      const before = noticeKind(job);
      job = { ...job, ...patch, updatedAt: this.time() };
      await this.write("job", {
        ...job,
        authorizedRoot: initial.authorizedRoot,
        ...(initial.mediaRoot ? { mediaRoot: initial.mediaRoot } : {}),
      });
      const kind = noticeKind(job);
      if (kind && kind !== before && this.runtime.notify) {
        const account = (await this.list<MultiPostAccount>("account", job.workspaceId)).find(
          (x) => x.id === job.accountId,
        );
        // Telling the person is a courtesy; it must never change how the post itself ended.
        await this.runtime
          .notify({
            kind,
            platformKey: account?.platformKey ?? "",
            label: account?.label ?? "",
          })
          .catch(() => {});
      }
    };
    try {
      if (
        !(await this.runtime.available()) ||
        Date.parse(job.dueAt) < this.startedAt ||
        this.missedIntervals.some(
          (interval) =>
            Date.parse(job.dueAt) > interval.start && Date.parse(job.dueAt) <= interval.end,
        )
      ) {
        await save({
          state: "missed",
          error: "Desktop was unavailable at the scheduled time. Review before retrying.",
        });
        return;
      }
      /** The saved revision must still be covered by a grant, autopilot or the user's approval. */
      const authorize = async () => {
        const current = await this.draft(scope, job.draftId, job.revision);
        if (job.grantId) return this.validGrant(scope, current, job.grantId);
        if (job.autopilot) {
          assert(
            this.autopilotOn(await this.read("account", job.accountId, job.workspaceId)),
            "Autopilot is off or expired for this account",
          );
          return null;
        }
        assert(
          current.approvedRevision === current.revision,
          "Publishing approval is no longer current",
        );
        return null;
      };
      await authorize();
      let account = await this.read<MultiPostAccount>("account", job.accountId, job.workspaceId);
      if (account.status === "disconnected") {
        await save({
          state: "needs-login",
          error: "Connect the selected account before publishing.",
        });
        return;
      }
      const identity = await this.runtime.identity(scope, account);
      if (
        account.identity &&
        (!identity || identityKey(identity) !== identityKey(account.identity))
      ) {
        await save({
          state: "needs-login",
          error: "Verify the selected platform account before publishing.",
        });
        return;
      }
      assert(!abort.signal.aborted, "Publishing cancelled");
      await save({ state: "preparing" });
      const prepared = await this.runtime.prepare({ scope, account, job }, abort.signal);
      if (abort.signal.aborted) return;
      if (prepared.state !== "prepared") {
        await save({ state: prepared.state, evidence: prepared });
        return;
      }
      await save({ state: "prepared", evidence: prepared });
      if (
        !identity ||
        !account.identity ||
        prepared.requiresManual ||
        this.capabilities.find((x) => x.id === job.adapterId)?.automaticSubmit === false
      ) {
        await save({
          evidence: {
            ...prepared,
            requiresManual: true,
            message:
              "Content prepared. Verify the account and complete final steps in its platform window.",
          },
        });
        return;
      }
      const latest = await this.read<MultiPostJob>("job", job.id, job.workspaceId);
      if (latest.state === "cancelled") return;
      await authorize();
      account = await this.read<MultiPostAccount>("account", job.accountId, job.workspaceId);
      const currentIdentity = await this.runtime.identity(scope, account);
      assert(
        currentIdentity &&
          account.identity &&
          identityKey(currentIdentity) === identityKey(identity) &&
          identityKey(currentIdentity) === identityKey(account.identity),
        "Platform account changed before submission",
      );
      assert(!abort.signal.aborted, "Publishing was cancelled");
      const grant = await authorize();
      if (job.autopilot) {
        await Effect.runPromise(
          this.sql.withTransaction(
            Effect.gen({ self: this }, function* () {
              const stored = yield* this.sql<{
                body: string;
              }>`SELECT body FROM multipost_records WHERE kind='account' AND id=${job.accountId}`;
              const fresh = JSON.parse(stored[0]!.body) as MultiPostAccount;
              assert(this.autopilotOn(fresh), "Autopilot is off or expired for this account");
              const key = `autopilot:${fresh.id}`;
              const day = clockDay(this.now(), fresh.autopilot!.timezone);
              const rows = yield* this
                .sql`INSERT INTO multipost_quota(job_id,grant_id,day) SELECT ${job.id},${key},${day} WHERE (SELECT COUNT(*) FROM multipost_quota WHERE grant_id=${key} AND day=${day})<${fresh.autopilot!.dailyLimit} ON CONFLICT(job_id) DO NOTHING RETURNING job_id`;
              assert(rows.length, "Autopilot reached its daily limit for this account");
            }),
          ),
        );
      }
      if (grant) {
        const authorizedGrant = grant;
        const day = clockDay(this.now(), grant.timezone);
        await Effect.runPromise(
          this.sql.withTransaction(
            Effect.gen({ self: this }, function* () {
              const stored = yield* this.sql<{
                body: string;
              }>`SELECT body FROM multipost_records WHERE kind='grant' AND id=${authorizedGrant.id}`;
              const fresh = JSON.parse(stored[0]!.body) as MultiPostGrant;
              assert(
                !fresh.revokedAt && Date.parse(fresh.expiresAt) > this.now().getTime(),
                "Publishing authorization expired or was revoked",
              );
              const rows = yield* this
                .sql`INSERT INTO multipost_quota(job_id,grant_id,day) SELECT ${job.id},${fresh.id},${day} WHERE (SELECT COUNT(*) FROM multipost_quota WHERE grant_id=${fresh.id} AND day=${day})<${fresh.dailyLimit} ON CONFLICT(job_id) DO NOTHING RETURNING job_id`;
              assert(rows.length, "Daily publishing quota reached");
            }),
          ),
        );
      }
      assert(!abort.signal.aborted, "Publishing was cancelled");
      await save({ state: "submitting", submittedAt: this.time() });
      if (abort.signal.aborted) {
        await save({ state: "cancelled", submittedAt: null });
        await Effect.runPromise(this.sql`DELETE FROM multipost_quota WHERE job_id=${job.id}`);
        return;
      }
      const result = await this.runtime.submit({ scope, account, job }, abort.signal);
      assertPublicationEvidence(job, result);
      if (result.dispatched === false)
        await Effect.runPromise(this.sql`DELETE FROM multipost_quota WHERE job_id=${job.id}`);
      await save({
        state: result.state,
        evidence: result,
        error: null,
        ...(result.state === "missed" || result.dispatched === false ? { submittedAt: null } : {}),
      });
      // The person already knows it is live; where it lives can follow a moment later, and
      // looking must never change how the post itself ended.
      if (result.state === "published" && !result.postUrl)
        await this.findLink(scope, job).catch(() => {});
    } catch (error) {
      const latest = await this.read<MultiPostJob>("job", job.id, job.workspaceId);
      const message = error instanceof Error ? error.message : "Publishing failed";
      if (latest.state === "cancelled") return;
      // Nothing was sent yet, so one more try cannot post twice.
      if (!job.submittedAt && !job.retriedAt && connectionLost(message))
        await save({
          state: "queued",
          dueAt: new Date(this.now().getTime() + RETRY_AFTER_MS).toISOString(),
          retriedAt: this.time(),
          error: null,
        });
      else await save({ state: job.submittedAt ? "uncertain" : "failed", error: message });
    } finally {
      this.aborts.delete(job.id);
    }
  }
}

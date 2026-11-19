import { ensureMultiPostSchema } from "./schema";
import { importMultiPostMedia, multiPostAttachments } from "./media";
import { stat } from "node:fs/promises";
import { normalizeContent } from "@synara/multipost";
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
  MultiPostScope,
  MultiPostState,
  MultiPostWorkflow,
} from "@synara/contracts";

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
        if (account.identity && identityKey(account.identity) !== identityKey(identity)) {
          for (const grant of await this.list<MultiPostGrant>("grant", scope.workspaceId))
            if (grant.accountIds.includes(account.id) && !grant.revokedAt)
              await this.write("grant", { ...grant, revokedAt: this.time() });
        }
        return this.write("account", { ...account, identity, status: "connected" });
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
        if (command.grantId) await this.validGrant(scope, draft, command.grantId);
        else
          assert(
            draft.approvedRevision === draft.revision,
            "Review and approve this content revision before publishing",
          );
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
            dueAt: draft.scheduledAt ?? this.time(),
            submittedAt: null,
            grantId: command.grantId ?? null,
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
      job = { ...job, ...patch, updatedAt: this.time() };
      await this.write("job", {
        ...job,
        authorizedRoot: initial.authorizedRoot,
        ...(initial.mediaRoot ? { mediaRoot: initial.mediaRoot } : {}),
      });
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
      const authorizedDraft = await this.draft(scope, job.draftId, job.revision);
      if (job.grantId) await this.validGrant(scope, authorizedDraft, job.grantId);
      else
        assert(
          authorizedDraft.approvedRevision === authorizedDraft.revision,
          "Publishing approval is no longer current",
        );
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
      const current = await this.draft(scope, job.draftId, job.revision);
      let grant: MultiPostGrant | null = null;
      if (job.grantId) grant = await this.validGrant(scope, current, job.grantId);
      else
        assert(
          current.approvedRevision === current.revision,
          "Publishing approval is no longer current",
        );
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
      const finalDraft = await this.draft(scope, job.draftId, job.revision);
      if (job.grantId) grant = await this.validGrant(scope, finalDraft, job.grantId);
      else
        assert(
          finalDraft.approvedRevision === finalDraft.revision,
          "Publishing approval is no longer current",
        );
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
    } catch (error) {
      const latest = await this.read<MultiPostJob>("job", job.id, job.workspaceId);
      if (latest.state !== "cancelled")
        await save({
          state: job.submittedAt ? "uncertain" : "failed",
          error: error instanceof Error ? error.message : "Publishing failed",
        });
    } finally {
      this.aborts.delete(job.id);
    }
  }
}

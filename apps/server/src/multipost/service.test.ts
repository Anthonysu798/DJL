import { afterEach, describe, expect, it } from "vitest";
import { Effect, ManagedRuntime } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { layerMemory } from "../persistence/NodeSqliteClient";
import { MultiPostService } from "./service";
import type {
  MultiPostBrowserRuntime,
  MultiPostScope,
  MultiPostDraft,
  MultiPostAccount,
  MultiPostState,
  MultiPostEvidence,
} from "@synara/contracts";
const scope: MultiPostScope = { workspaceId: "a", threadId: "chat-a", authorizedRoot: "/tmp" };
const capability = {
  id: "DYNAMIC_X",
  platformKey: "x",
  kind: "dynamic" as const,
  displayName: "X",
  homeUrl: "https://x.com",
  injectUrl: "https://x.com/home",
  identitySupported: true,
};
const noPreparationHook = async () => {};
const resources: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) await r.dispose();
});
async function setup(platformKey = "x", adapterId = "DYNAMIC_X") {
  const db = ManagedRuntime.make(layerMemory());
  resources.push(db);
  let sends = 0;
  let beforePrepare = noPreparationHook;
  const runtime: MultiPostBrowserRuntime = {
    available: async () => true,
    connect: async () => {},
    disconnect: async () => {},
    identity: async () => ({
      provider: platformKey,
      accountId: "real-user",
      username: "tester",
      verifiedAt: "2026-11-05T12:00:00Z",
    }),
    prepare: async () => {
      await beforePrepare();
      return { state: "prepared", observedAt: new Date().toISOString() };
    },
    submit: async () => {
      sends++;
      return {
        state: "published",
        postUrl: "https://x.com/tester/status/123",
        observedAt: new Date().toISOString(),
      };
    },
    verify: async () => ({ state: "uncertain", observedAt: new Date().toISOString() }),
    cancel: async () => ({ state: "uncertain", observedAt: new Date().toISOString() }),
  };
  const sql = await db.runPromise(Effect.service(SqlClient.SqlClient));
  const service = new MultiPostService(
    sql,
    runtime,
    [{ ...capability, platformKey, id: adapterId }],
    () => new Date("2026-11-05T12:00:00Z"),
  );
  await service.initialize();
  const account = (await service.command(
    scope,
    { action: "create-account", platformKey, label: "Personal" },
    "ui",
  )) as MultiPostAccount;
  await service.command(scope, { action: "verify-account", accountId: account.id }, "ui");
  const draft = (await service.command(
    scope,
    {
      action: "save-draft",
      draft: {
        kind: "dynamic",
        data: { title: "Trip", content: "Real content" },
        targets: [{ accountId: account.id, adapterId }],
        publicationMode: "now",
        scheduledAt: null,
        timezone: "America/Toronto",
      },
    },
    "agent",
  )) as MultiPostDraft;
  return {
    service,
    sql,
    runtime,
    account,
    draft,
    sends: () => sends,
    onPrepare: (fn: () => Promise<void>) => {
      beforePrepare = fn;
    },
  };
}
describe("MultiPost authorization and durable execution", () => {
  it("never lets an agent approve or grant itself permission", async () => {
    const { service, draft } = await setup();
    await expect(
      service.command(scope, { action: "approve-draft", draftId: draft.id, revision: 1 }, "agent"),
    ).rejects.toThrow(/user|human|UI/i);
    await expect(
      service.command(scope, { action: "submit-draft", draftId: draft.id, revision: 1 }, "agent"),
    ).rejects.toThrow(/review|approv|author/i);
  });
  it("scopes records and invalidates approval on edits", async () => {
    const { service, draft } = await setup();
    await service.command(scope, { action: "approve-draft", draftId: draft.id, revision: 1 }, "ui");
    const revised = (await service.command(
      scope,
      { action: "save-draft", draft: { ...draft, data: { title: "Changed" } } },
      "agent",
    )) as MultiPostDraft;
    expect(revised.revision).toBe(2);
    expect(revised.approvedRevision).toBeNull();
    await expect(
      service.command(
        { ...scope, workspaceId: "b" },
        { action: "review-draft", draftId: draft.id, revision: 2 },
        "agent",
      ),
    ).rejects.toThrow(/missing|found|workspace/i);
    await expect(
      service.command(
        scope,
        { action: "save-draft", draft: { ...draft, data: { title: "Stale" } } },
        "ui",
      ),
    ).rejects.toThrow(/changed|stale|revision/i);
  });
  it("deduplicates repeated submissions and stores real provider evidence", async () => {
    const { service, draft, sends } = await setup();
    await service.command(scope, { action: "approve-draft", draftId: draft.id, revision: 1 }, "ui");
    await Promise.all(
      [1, 2].map(() =>
        service.command(scope, { action: "submit-draft", draftId: draft.id, revision: 1 }, "agent"),
      ),
    );
    await service.runDue();
    await service.runDue();
    const state = (await service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(state.jobs).toHaveLength(1);
    expect(sends()).toBe(1);
    expect(state.jobs[0]?.evidence?.postUrl).toContain("/status/123");
  });
  it("does not retry an uncertain irreversible submission", async () => {
    const { service, runtime, draft } = await setup();
    runtime.submit = async () => {
      throw new Error("connection lost after dispatch");
    };
    await service.command(scope, { action: "approve-draft", draftId: draft.id, revision: 1 }, "ui");
    await service.command(scope, { action: "submit-draft", draftId: draft.id, revision: 1 }, "ui");
    await service.runDue();
    const state = (await service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(state.jobs[0]?.state).toBe("uncertain");
    await expect(
      service.command(scope, { action: "retry-job", jobId: state.jobs[0]!.id }, "ui"),
    ).rejects.toThrow(/uncertain|verif|submitted/i);
  });
  it("does not call native scheduled cancellation successful without evidence", async () => {
    const { service, runtime, draft } = await setup();
    runtime.submit = async () => ({
      state: "scheduled-on-platform",
      observedAt: new Date().toISOString(),
    });
    await service.command(scope, { action: "approve-draft", draftId: draft.id, revision: 1 }, "ui");
    await service.command(scope, { action: "submit-draft", draftId: draft.id, revision: 1 }, "ui");
    await service.runDue();
    let state = (await service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    await service.command(scope, { action: "cancel-job", jobId: state.jobs[0]!.id }, "ui");
    state = (await service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(state.jobs[0]?.state).not.toBe("cancelled");
  });
});

describe("standing grants and recovery", () => {
  async function grantSetup() {
    const context = await setup();
    const workflow = (await context.service.command(
      scope,
      {
        action: "save-workflow",
        workflow: { name: "Publishing", accountIds: [context.account.id], kinds: ["dynamic"] },
      },
      "ui",
    )) as import("@synara/contracts").MultiPostWorkflow;
    const grantInput = {
      workflowId: workflow.id,
      workflowRevision: workflow.revision,
      accountIds: workflow.accountIds,
      kinds: workflow.kinds,
      expiresAt: "2026-12-01T00:00:00Z",
      dailyLimit: 1,
      timezone: "America/Toronto",
    };
    await expect(
      context.service.command(scope, { action: "create-grant", grant: grantInput }, "agent"),
    ).rejects.toThrow(/user|UI/i);
    const grant = (await context.service.command(
      scope,
      { action: "create-grant", grant: grantInput },
      "ui",
    )) as import("@synara/contracts").MultiPostGrant;
    const draft = (await context.service.command(
      scope,
      {
        action: "save-draft",
        draft: { ...context.draft, workflowId: workflow.id, workflowRevision: workflow.revision },
      },
      "agent",
    )) as MultiPostDraft;
    return { ...context, workflow, grant, draft };
  }
  it("disconnecting an account revokes its grants and cancels queued publishing", async () => {
    const c = await grantSetup();
    await c.service.command(
      scope,
      {
        action: "submit-draft",
        draftId: c.draft.id,
        revision: c.draft.revision,
        grantId: c.grant.id,
      },
      "agent",
    );
    await c.service.command(scope, { action: "disconnect-account", accountId: c.account.id }, "ui");
    const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(state.accounts[0]).toMatchObject({ status: "disconnected", identity: null });
    expect(state.grants[0]!.revokedAt).not.toBeNull();
    expect(state.jobs[0]!.state).toBe("cancelled");
    await c.service.runDue();
    expect(c.sends()).toBe(0);
  });
  it("enforces per-target daily quota without human approval bypass", async () => {
    const c = await grantSetup();
    await c.service.command(
      scope,
      {
        action: "submit-draft",
        draftId: c.draft.id,
        revision: c.draft.revision,
        grantId: c.grant.id,
      },
      "agent",
    );
    await c.service.runDue();
    const second = (await c.service.command(
      scope,
      {
        action: "save-draft",
        draft: {
          kind: c.draft.kind,
          targets: c.draft.targets,
          publicationMode: c.draft.publicationMode,
          scheduledAt: c.draft.scheduledAt,
          timezone: c.draft.timezone,
          workflowId: c.workflow.id,
          workflowRevision: c.workflow.revision,
          data: { title: "Another", content: "Different content" },
        },
      },
      "agent",
    )) as MultiPostDraft;
    await c.service.command(
      scope,
      {
        action: "submit-draft",
        draftId: second.id,
        revision: second.revision,
        grantId: c.grant.id,
      },
      "agent",
    );
    await c.service.runDue();
    const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(c.sends()).toBe(1);
    expect(state.jobs.find((j) => j.draftId === second.id)?.error).toMatch(/quota/);
  });
  it("revocation during preparation cancels before final submission", async () => {
    const c = await grantSetup();
    c.onPrepare(async () => {
      await c.service.command(scope, { action: "revoke-grant", grantId: c.grant.id }, "ui");
    });
    await c.service.command(
      scope,
      {
        action: "submit-draft",
        draftId: c.draft.id,
        revision: c.draft.revision,
        grantId: c.grant.id,
      },
      "agent",
    );
    await c.service.runDue();
    const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(c.sends()).toBe(0);
    expect(state.jobs[0]?.state).toBe("cancelled");
  });
  it("detects an account switch after preparation", async () => {
    const c = await setup();
    c.onPrepare(async () => {
      c.runtime.identity = async () => ({
        provider: "x",
        accountId: "different",
        username: "different",
        verifiedAt: "2026-11-05T12:00:00Z",
      });
    });
    await c.service.command(
      scope,
      { action: "approve-draft", draftId: c.draft.id, revision: c.draft.revision },
      "ui",
    );
    await c.service.command(
      scope,
      { action: "submit-draft", draftId: c.draft.id, revision: c.draft.revision },
      "ui",
    );
    await c.service.runDue();
    expect(c.sends()).toBe(0);
    const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(state.jobs[0]?.error).toMatch(/account changed/i);
  });
  it("marks due jobs missed while the desktop is unavailable", async () => {
    const c = await setup();
    c.runtime.available = async () => false;
    await c.service.command(
      scope,
      { action: "approve-draft", draftId: c.draft.id, revision: c.draft.revision },
      "ui",
    );
    await c.service.command(
      scope,
      { action: "submit-draft", draftId: c.draft.id, revision: c.draft.revision },
      "ui",
    );
    await c.service.runDue();
    const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(state.jobs[0]?.state).toBe("missed");
    expect(c.sends()).toBe(0);
  });
  it("rejects scheduled instants without an explicit offset", async () => {
    const c = await setup();
    await expect(
      c.service.command(
        scope,
        {
          action: "save-draft",
          draft: { ...c.draft, publicationMode: "scheduled", scheduledAt: "2026-11-06T12:00:00" },
        },
        "ui",
      ),
    ).rejects.toThrow(/offset|timezone/i);
  });
});

describe("queued snapshot controls", () => {
  it("does not upload a stale queued revision before checking approval", async () => {
    const c = await setup();
    let prepares = 0;
    c.runtime.prepare = async () => {
      prepares++;
      return { state: "prepared", observedAt: new Date().toISOString() };
    };
    await c.service.command(
      scope,
      { action: "approve-draft", draftId: c.draft.id, revision: 1 },
      "ui",
    );
    await c.service.command(
      scope,
      { action: "submit-draft", draftId: c.draft.id, revision: 1 },
      "ui",
    );
    await c.service.command(
      scope,
      { action: "save-draft", draft: { ...c.draft, data: { title: "Changed" } } },
      "ui",
    );
    await c.service.runDue();
    expect(prepares).toBe(0);
  });
  it("preserves selected media in copy-only agent edits", async () => {
    const c = await setup();
    const media = { name: "photo.jpg", url: "photo.jpg", type: "image/jpeg" };
    const first = (await c.service.command(
      scope,
      {
        action: "save-draft",
        draft: { ...c.draft, data: { title: "Original", content: "Copy", images: [media] } },
      },
      "agent",
    )) as MultiPostDraft;
    const second = (await c.service.command(
      scope,
      {
        action: "save-draft",
        draft: { ...first, data: { title: "Original", content: "New copy" } },
      },
      "agent",
    )) as MultiPostDraft;
    expect(second.data.images).toEqual([media]);
  });
});

it("normalizes offset schedules to UTC before selecting due jobs", async () => {
  const c = await setup();
  const scheduled = (await c.service.command(
    scope,
    {
      action: "save-draft",
      draft: { ...c.draft, publicationMode: "scheduled", scheduledAt: "2026-11-05T08:30:00-05:00" },
    },
    "ui",
  )) as MultiPostDraft;
  await c.service.command(
    scope,
    { action: "approve-draft", draftId: scheduled.id, revision: scheduled.revision },
    "ui",
  );
  await c.service.command(
    scope,
    { action: "submit-draft", draftId: scheduled.id, revision: scheduled.revision },
    "ui",
  );
  await c.service.runDue();
  expect(c.sends()).toBe(0);
  const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
  expect(state.jobs[0]?.dueAt).toBe("2026-11-05T13:30:00.000Z");
  expect(state.jobs[0]?.state).toBe("queued");
});

it("validates target-native schedule overrides instead of letting them bypass platform capability checks", async () => {
  const c = await setup();
  await expect(
    c.service.command(
      scope,
      {
        action: "save-draft",
        draft: {
          ...c.draft,
          targets: [
            {
              ...c.draft.targets[0]!,
              overrides: { scheduledPublishTime: Date.parse("2026-11-06T12:00:00Z") },
            },
          ],
        },
      },
      "agent",
    ),
  ).rejects.toThrow(/native scheduling/);
});

it("returns a scoped human authorization UI link without approving a workflow", async () => {
  const c = await setup();
  expect(
    await c.service.command(
      scope,
      { action: "request-authorization", workflowId: "workflow" },
      "agent",
    ),
  ).toMatchObject({
    requiresUserAction: true,
    uiPath: "#/social/chat-a?multipostView=authorizations&workflowId=workflow",
  });
  expect(
    ((await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState).grants,
  ).toHaveLength(0);
});

it("does not catch up a task missed during a short app exit", async () => {
  const c = await setup();
  await c.service.command(
    scope,
    { action: "approve-draft", draftId: c.draft.id, revision: c.draft.revision },
    "ui",
  );
  await c.service.command(
    scope,
    { action: "submit-draft", draftId: c.draft.id, revision: c.draft.revision },
    "ui",
  );
  const restarted = new MultiPostService(
    c.sql,
    c.runtime,
    [capability],
    () => new Date("2026-11-05T12:00:10Z"),
  );
  await restarted.initialize();
  await restarted.runDue();
  expect(c.sends()).toBe(0);
  expect(
    ((await restarted.command(scope, { action: "state" }, "ui")) as MultiPostState).jobs[0]!.state,
  ).toBe("missed");
});

it("does not submit a revision edited while the final account identity check is in flight", async () => {
  const c = await setup();
  await c.service.command(
    scope,
    { action: "approve-draft", draftId: c.draft.id, revision: c.draft.revision },
    "ui",
  );
  await c.service.command(
    scope,
    { action: "submit-draft", draftId: c.draft.id, revision: c.draft.revision },
    "ui",
  );
  const identity = c.runtime.identity;
  let calls = 0;
  let began!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  c.runtime.identity = async (...args) => {
    if (++calls === 2) {
      began();
      await paused;
    }
    return identity(...args);
  };
  const running = c.service.runDue();
  await started;
  await c.service.command(
    scope,
    {
      action: "save-draft",
      draft: {
        ...c.draft,
        data: { title: "Edited during identity verification", content: "Needs a fresh review" },
      },
    },
    "agent",
  );
  resume();
  await running;
  expect(c.sends()).toBe(0);
  const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
  expect(state.drafts[0]!.approvedRevision).toBeNull();
  expect(state.jobs[0]!.state).not.toBe("published");
});

it("retains Instagram's authenticated provider confirmation when no permalink is returned", async () => {
  const c = await setup("instagram", "DYNAMIC_INSTAGRAM");
  c.runtime.submit = async () => ({
    state: "published",
    providerConfirmation: "instagram-post-shared",
    message: "Instagram confirmed that the post was shared.",
    observedAt: "2026-11-05T12:00:00Z",
  });
  await c.service.command(
    scope,
    { action: "approve-draft", draftId: c.draft.id, revision: 1 },
    "ui",
  );
  await c.service.command(
    scope,
    { action: "submit-draft", draftId: c.draft.id, revision: 1 },
    "ui",
  );
  await c.service.runDue();
  const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
  expect(state.jobs[0]).toMatchObject({
    state: "published",
    evidence: { providerConfirmation: "instagram-post-shared" },
    error: null,
  });
  expect(state.jobs[0]?.evidence?.postUrl).toBeUndefined();
});

it.each([false, true])(
  "rejects published results without matching provider evidence (foreign receipt: %s)",
  async (foreign) => {
    const c = await setup();
    c.runtime.submit = async () => ({
      state: "published",
      ...(foreign ? { providerConfirmation: "instagram-post-shared" } : {}),
      observedAt: "2026-11-05T12:00:00Z",
    });
    await c.service.command(
      scope,
      { action: "approve-draft", draftId: c.draft.id, revision: 1 },
      "ui",
    );
    await c.service.command(
      scope,
      { action: "submit-draft", draftId: c.draft.id, revision: 1 },
      "ui",
    );
    await c.service.runDue();
    const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
    expect(state.jobs[0]?.state).toBe("uncertain");
    expect(state.jobs[0]?.error).toMatch(/provider evidence/);
  },
);

it("does not let a slow verification overwrite a completed submission or its retry fence", async () => {
  const c = await setup();
  await c.service.command(
    scope,
    { action: "approve-draft", draftId: c.draft.id, revision: 1 },
    "ui",
  );
  await c.service.command(
    scope,
    { action: "submit-draft", draftId: c.draft.id, revision: 1 },
    "ui",
  );
  const queued = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
  let release!: (value: MultiPostEvidence) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  c.runtime.verify = async () => {
    began();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const verification = c.service.command(
    scope,
    { action: "verify-job", jobId: queued.jobs[0]!.id },
    "agent",
  );
  await started;
  await c.service.runDue();
  release({ state: "uncertain", observedAt: "2026-11-05T12:00:00Z" });
  await verification;
  const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
  expect(state.jobs[0]).toMatchObject({
    state: "published",
    evidence: { postUrl: "https://x.com/tester/status/123" },
  });
  expect(state.jobs[0]?.submittedAt).not.toBeNull();
  expect(c.sends()).toBe(1);
});

it("does not accept an evidence-free published claim from manual verification", async () => {
  const c = await setup();
  c.runtime.submit = async () => ({ state: "uncertain", observedAt: "2026-11-05T12:00:00Z" });
  await c.service.command(
    scope,
    { action: "approve-draft", draftId: c.draft.id, revision: 1 },
    "ui",
  );
  await c.service.command(
    scope,
    { action: "submit-draft", draftId: c.draft.id, revision: 1 },
    "ui",
  );
  await c.service.runDue();
  const state = (await c.service.command(scope, { action: "state" }, "ui")) as MultiPostState;
  c.runtime.verify = async () => ({ state: "published", observedAt: "2026-11-05T12:00:00Z" });
  await expect(
    c.service.command(scope, { action: "verify-job", jobId: state.jobs[0]!.id }, "agent"),
  ).rejects.toThrow(/provider evidence/);
});

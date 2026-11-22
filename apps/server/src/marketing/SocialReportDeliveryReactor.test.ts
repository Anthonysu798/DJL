import { CommandId, ProjectId, ThreadId, createCampaign } from "@djl/contracts";
import type { CloudSocialReportsResponse } from "@djl/contracts/cloud";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ServerConfig } from "../config";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite";
import { agentOwnerFromSession } from "./agentScope";
import { deliverSocialReports } from "./SocialReportDeliveryReactor";
import { readDocument, saveDocument } from "./store";

const session = {
  apiBaseUrl: "https://cloud.test",
  token: "never-in-chat",
  userId: "user",
  orgId: "org",
  email: "",
  createdAt: "",
};
const threadId = ThreadId.makeUnsafe("recap-chat");
const createdAt = "2026-10-20T09:00:00.000Z";
const reportState: CloudSocialReportsResponse = {
  schedule: {
    id: "schedule",
    draftId: "draft",
    threadId,
    enabled: true,
    timezone: "America/Toronto",
    weekday: 1,
    hour: 9,
    minute: 0,
    nextRunAt: "2026-11-02T14:00:00.000Z",
  },
  reports: [
    {
      id: "weekly-report",
      threadId,
      periodStart: "2026-10-19T14:00:00.000Z",
      periodEnd: "2026-10-26T14:00:00.000Z",
      retrievedAt: "2026-10-26T14:01:00.000Z",
      publishedPosts: 3,
      inspectedPosts: 2,
      truncated: true,
      partial: true,
      providers: [
        {
          provider: "instagram",
          publishedPosts: 3,
          metrics: { views: 17, likes: 0, comments: null, shares: null },
        },
      ],
      posts: [],
    },
  ],
};

async function openSystem(directory: string) {
  const sqlite = makeSqlitePersistenceLive(path.join(directory, "state.sqlite"));
  const layer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provideMerge(sqlite),
    Layer.provideMerge(ServerConfig.layerTest(directory, directory)),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(layer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const query = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
  return {
    engine,
    run: runtime.runPromise.bind(runtime),
    dispose: () => runtime.dispose(),
    chat: async () =>
      Option.getOrThrow(await runtime.runPromise(query.getThreadDetailById(threadId))),
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "djl-recap-delivery-"));
  const system = await openSystem(directory);
  const campaign = {
    ...createCampaign("Recap"),
    threadId,
    ownerKey: agentOwnerFromSession(session).key,
  };
  const binding = { ...session, token: undefined, campaignId: campaign.id, draftId: "draft" };
  await system.run(
    Effect.gen(function* () {
      yield* system.engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("project"),
        projectId: ProjectId.makeUnsafe("project"),
        title: "Project",
        workspaceRoot: directory,
        defaultModelSelection: { provider: "codex", model: "test" },
        createdAt,
      });
      yield* system.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("thread"),
        projectId: ProjectId.makeUnsafe("project"),
        threadId,
        title: "Chat",
        branch: null,
        worktreePath: null,
        modelSelection: { provider: "codex", model: "test" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt,
      });
      yield* saveDocument("campaign", campaign.id, campaign, null);
      yield* saveDocument("social-draft-link", "draft", binding, null);
    }),
  );
  let currentSession: typeof session | null = session;
  let reads = 0;
  let response = structuredClone(reportState);
  let afterFetch: (() => void | Promise<void>) | undefined;
  const deps = {
    session: async () => currentSession,
    client: (baseUrl: string, orgId: string) => ({
      get: async (route: string, token: string) => {
        expect([baseUrl, orgId, route, token]).toEqual([
          session.apiBaseUrl,
          session.orgId,
          "/v1/social/drafts/draft/reports",
          session.token,
        ]);
        reads++;
        await afterFetch?.();
        return response;
      },
    }),
  };
  return {
    directory,
    system,
    campaign,
    binding,
    deps,
    reads: () => reads,
    setSession: (value: typeof session | null) => {
      currentSession = value;
    },
    setResponse: (value: CloudSocialReportsResponse) => {
      response = value;
    },
    afterFetch: (callback: () => void | Promise<void>) => {
      afterFetch = callback;
    },
    clean: async () => {
      await system.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

describe("persisted weekly recap chat delivery", () => {
  it("persists one completed assistant message with official metric evidence across restarts", async () => {
    const f = await fixture();
    try {
      await f.system.run(deliverSocialReports("/unused", f.system.engine, f.deps as never));
      await f.system.run(deliverSocialReports("/unused", f.system.engine, f.deps as never));
      const chat = (await f.system.run(f.system.engine.getReadModel())).threads[0]!;
      expect(chat.messages).toHaveLength(1);
      expect(chat.messages[0]).toMatchObject({ role: "assistant", streaming: false, turnId: null });
      expect(chat.messages[0]!.text).toContain("Views: 17");
      expect(chat.messages[0]!.text).toContain("Likes: 0");
      expect(chat.messages[0]!.text).toContain("Comments: Unavailable");
      expect(chat.messages[0]!.text).toContain("2026-10-26T14:01:00.000Z");
      expect(chat.messages[0]!.text).toContain("2 of 3");
      expect(chat.messages[0]!.text).toContain("Cumulative");
      expect(JSON.stringify(chat)).not.toContain(session.token);
      expect(chat.latestTurn).toBeNull();
      await f.system.dispose();
      const restarted = await openSystem(f.directory);
      try {
        await restarted.run(deliverSocialReports("/unused", restarted.engine, f.deps as never));
        expect((await restarted.chat()).messages).toHaveLength(1);
      } finally {
        await restarted.dispose();
      }
    } finally {
      await f.clean();
    }
  });

  it("reuses the persisted command receipt if interrupted after appending the message", async () => {
    const f = await fixture();
    try {
      const interrupted = {
        ...f.system.engine,
        dispatch: (command: Parameters<typeof f.system.engine.dispatch>[0]) =>
          f.system.engine
            .dispatch(command)
            .pipe(Effect.andThen(Effect.fail(new Error("process stopped")))),
      };
      await f.system.run(deliverSocialReports("/unused", interrupted as never, f.deps as never));
      await f.system.dispose();
      const restarted = await openSystem(f.directory);
      try {
        await restarted.run(deliverSocialReports("/unused", restarted.engine, f.deps as never));
        expect((await restarted.chat()).messages).toHaveLength(1);
      } finally {
        await restarted.dispose();
      }
    } finally {
      await f.clean();
    }
  });

  it.each(["userId", "orgId", "apiBaseUrl"] as const)(
    "ignores bindings owned by another %s",
    async (key) => {
      const f = await fixture();
      try {
        f.setSession({ ...session, [key]: "other" });
        await f.system.run(deliverSocialReports("/unused", f.system.engine, f.deps as never));
        expect(f.reads()).toBe(0);
        expect(
          (await f.system.run(f.system.engine.getReadModel())).threads[0]!.messages,
        ).toHaveLength(0);
      } finally {
        await f.clean();
      }
    },
  );

  it.each([null, { ...session, userId: "other" }, { ...session, orgId: "other" }])(
    "discards a response after a session change during the request: %j",
    async (nextSession) => {
      const f = await fixture();
      try {
        f.afterFetch(() => f.setSession(nextSession));
        await f.system.run(deliverSocialReports("/unused", f.system.engine, f.deps as never));
        expect(
          (await f.system.run(f.system.engine.getReadModel())).threads[0]!.messages,
        ).toHaveLength(0);
      } finally {
        await f.clean();
      }
    },
  );

  it("discards a late response after a local campaign changes owner", async () => {
    const f = await fixture();
    try {
      f.afterFetch(async () => {
        await f.system.run(
          Effect.gen(function* () {
            const saved = yield* readDocument("campaign", f.campaign.id);
            yield* saveDocument(
              "campaign",
              f.campaign.id,
              { ...f.campaign, ownerKey: "foreign" },
              saved!.version,
            );
          }),
        );
      });
      await f.system.run(deliverSocialReports("/unused", f.system.engine, f.deps as never));
      expect((await f.system.chat()).messages).toHaveLength(0);
      await f.system.run(deliverSocialReports("/unused", f.system.engine, f.deps as never));
      expect(f.reads()).toBe(1);
    } finally {
      await f.clean();
    }
  });

  it.each(["disabled", "draft", "thread", "report"])(
    "does not deliver a %s response outside the saved subscription",
    async (change) => {
      const f = await fixture();
      try {
        const value = {
          ...reportState,
          schedule: {
            ...reportState.schedule,
            ...(change === "disabled" ? { enabled: false } : {}),
            ...(change === "draft" ? { draftId: "foreign" } : {}),
            ...(change === "thread" ? { threadId: "foreign" } : {}),
          },
          reports:
            change === "report"
              ? [Object.assign({}, reportState.reports[0], { threadId: "foreign" })]
              : reportState.reports,
        };
        f.setResponse(value);
        await f.system.run(deliverSocialReports("/unused", f.system.engine, f.deps as never));
        expect(
          (await f.system.run(f.system.engine.getReadModel())).threads[0]!.messages,
        ).toHaveLength(0);
      } finally {
        await f.clean();
      }
    },
  );
});

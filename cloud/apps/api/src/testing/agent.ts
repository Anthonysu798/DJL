/**
 * Agent test harness: the real ledger, gateway, run log, chat, and tools over
 * the test database and Redis, with a scripted model provider, the fake web
 * search, the mock sandbox (which runs nothing), and mock push and email.
 */
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { MockOutbox, MockPushSender } from "@djl/notify";
import type { ChatRequest, ProviderAdapter } from "@djl/providers";
import type { CloudSendMessageInput } from "@synara/contracts/cloud";
import { Redis } from "ioredis";

import { AgentRunner, type AgentRunnerDeps } from "../agent/AgentRunner.ts";
import { createFakeWebSearch, type WebSearch } from "../agent/exa.ts";
import { createImageTools } from "../agent/imageTools.ts";
import { RunNotifier } from "../agent/RunNotifier.ts";
import { createMockSandbox } from "../agent/sandbox/Sandbox.ts";
import { createSandboxTools } from "../agent/sandboxTools.ts";
import { ToolBilling } from "../agent/ToolBilling.ts";
import { createWebTools } from "../agent/webTools.ts";
import type { Principal } from "../auth/guard.ts";
import { ChatService } from "../chat/ChatService.ts";
import { Settings } from "../config/settings.ts";
import { LedgerService } from "../credits/LedgerService.ts";
import { FileService } from "../files/FileService.ts";
import { createFakeProvider } from "../gateway/fakeProvider.ts";
import { GatewayService, type RequestFacts } from "../gateway/GatewayService.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ChatRunner } from "../runs/ChatRunner.ts";
import { RunLog, type RunEvent } from "../runs/RunLog.ts";
import { RunService } from "../runs/RunService.ts";
import { FakeBlobStore } from "../sync/BlobStore.ts";
import { seedOrg, testDatabase } from "./db.ts";

export interface Turn {
  readonly text?: string;
  readonly calls?: readonly { readonly name: string; readonly args: Record<string, unknown> }[];
  /** Wait this long (abortably) before answering. */
  readonly delayMs?: number;
}

export type Script = (request: ChatRequest, n: number) => Turn;

/** A provider that answers each chat call from the current script. */
function scriptedProvider(state: { script: Script; requests: ChatRequest[] }): ProviderAdapter {
  const fake = createFakeProvider();
  return {
    ...fake,
    async *chatStream(req, signal) {
      state.requests.push(req);
      const n = state.requests.length;
      const turn = state.script(req, n);
      const id = `scripted-${n}`;
      if (turn.delayMs)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, turn.delayMs);
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
      yield { id, delta: { role: "assistant" }, finish_reason: null };
      const text = turn.text ?? "";
      for (let i = 0; i < text.length; i += 8) {
        if (signal.aborted) return;
        yield { id, delta: { content: text.slice(i, i + 8) }, finish_reason: null };
      }
      for (const [index, call] of (turn.calls ?? []).entries())
        yield {
          id,
          delta: {
            tool_calls: [
              {
                index,
                id: `call_${n}_${index}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          },
          finish_reason: null,
        };
      yield {
        id,
        delta: {},
        finish_reason: turn.calls?.length ? "tool_calls" : "stop",
        usage: { input_tokens: 200, output_tokens: 40, cached_input_tokens: 0 },
      };
    },
  };
}

export const MODEL = "gpt-5-mini";

export function agentHarness() {
  const conn = testDatabase();
  const db = conn.db;
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63799", {
    maxRetriesPerRequest: 2,
  });
  const ledger = new LedgerService(db);
  const settings = new Settings(db, { ttlMs: 0 });
  const model = { script: (() => ({ text: "Done." })) as Script, requests: [] as ChatRequest[] };
  const provider = scriptedProvider(model);
  const gateway = new GatewayService({
    db,
    ledger,
    limiter: createMemoryRateLimiter(),
    settings,
    providers: {
      openai: { ...provider, id: "openai" },
      anthropic: { ...provider, id: "anthropic" },
      openrouter: { ...provider, id: "openrouter" },
    },
    trial: { onFirstCloudRequest: async () => false },
    config: { region: "test", catalogTtlMs: 0, refusalFlagThreshold: 100 },
  });
  const blobs = new FakeBlobStore();
  const log = new RunLog(db, redis);
  const files = new FileService(db, blobs, settings);
  const enqueued: string[] = [];
  const chat = new ChatService({
    db,
    files,
    runner: new ChatRunner({ db, gateway, log, blobs }),
    tasks: { enqueue: async (runId) => void enqueued.push(runId) },
  });
  const runs = new RunService(db, log, 200);
  const sandbox = createMockSandbox();
  const push = new MockPushSender();
  const outbox = new MockOutbox();
  const notifier = new RunNotifier({ db, push, email: outbox, webPublicUrl: "https://app.test" });
  const billing = new ToolBilling(db, ledger);

  /** An AgentRunner over the harness; `web` replaces the fake search for one test. */
  function agent(overrides: Partial<AgentRunnerDeps> & { readonly web?: WebSearch } = {}) {
    const { web = createFakeWebSearch(), ...rest } = overrides;
    return new AgentRunner({
      db,
      log,
      blobs,
      settings,
      gateway,
      billing,
      sandbox,
      notifier,
      tools: [
        ...createWebTools(web),
        ...createImageTools({ db, blobs, gateway }),
        ...createSandboxTools({ db, blobs }),
      ],
      cancelPollMs: 10,
      retryDelayMs: 10,
      ...rest,
    });
  }

  async function user(
    label: string,
    credits = 100,
    plan: "business" | "free" = "business",
  ): Promise<{ p: Principal; facts: RequestFacts }> {
    const { orgId, userId } = await seedOrg(db, label);
    // A paid plan, so the 5-hour and weekly windows are wide enough for tool-heavy tasks.
    if (plan === "business")
      await db.insert(schema.subscriptions).values({
        orgId,
        planId: "business",
        stripeSubscriptionId: `sub_test_${orgId}`,
        status: "active",
        interval: "month",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      });
    if (credits > 0)
      await ledger.grant({
        orgId,
        bucket: "topup",
        type: "topup",
        amount: creditsToMicro(credits),
        idempotencyKey: `agent-test:${orgId}`,
        actor: "test",
      });
    const p: Principal = {
      userId,
      email: `${label}@test.invalid`,
      emailVerified: true,
      banned: false,
      sessionId: "s",
      orgId,
      role: "owner",
      personalOrgId: orgId,
    };
    return { p, facts: { principal: p, traceId: "t", ipHash: null, deviceId: null } };
  }

  /** Uploads and completes a file as the user. */
  async function uploadFile(
    p: Principal,
    bytes: Uint8Array,
    mimeType: string,
    purpose: "attachment" | "image" = "attachment",
  ) {
    const sha256 = Buffer.from(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ).toString("hex");
    const created = await files.create(p, {
      name: "upload.bin",
      mimeType,
      size: bytes.byteLength,
      sha256,
      purpose,
    } as never);
    blobs.put(`org/${p.orgId}/files/${created.file.id}`, bytes, mimeType);
    await files.complete(p, created.file.id);
    return created.file.id;
  }

  /** A user with a conversation whose last message starts a queued task run. */
  async function task(
    label: string,
    parts: CloudSendMessageInput["parts"] | string,
    options: {
      readonly credits?: number;
      readonly plan?: "business" | "free";
      readonly as?: { p: Principal; facts: RequestFacts };
    } = {},
  ) {
    const u = options.as ?? (await user(label, options.credits, options.plan));
    const conversation = await chat.create(u.p, {});
    const sent = await chat.send(u.facts, conversation.id, {
      clientMessageId: crypto.randomUUID(),
      parentId: null,
      parts: typeof parts === "string" ? [{ type: "text", text: parts }] : parts,
      model: MODEL,
      mode: "task",
    } as unknown as CloudSendMessageInput);
    return { ...u, runId: sent.run.id, messageId: sent.reply.id, conversationId: conversation.id };
  }

  async function run(runId: string) {
    return (await db.query.runs.findFirst({ where: eq(schema.runs.id, runId) }))!;
  }

  async function reply(messageId: string) {
    const row = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    return (row?.parts ?? []) as readonly { type: string; [k: string]: unknown }[];
  }

  async function events(runId: string): Promise<RunEvent[]> {
    return log.read(runId, 0);
  }

  /** Sets tool prices (microcredits) for one test and returns a restore function. */
  async function priceTools(prices: Record<string, bigint>) {
    const saved = await db.select().from(schema.toolPrices);
    for (const [tool, microPerUnit] of Object.entries(prices))
      await db
        .insert(schema.toolPrices)
        .values({ tool, unit: "call", microPerUnit })
        .onConflictDoUpdate({ target: schema.toolPrices.tool, set: { microPerUnit } });
    return async () => {
      await db.delete(schema.toolPrices);
      if (saved.length) await db.insert(schema.toolPrices).values(saved);
    };
  }

  return {
    db,
    ledger,
    blobs,
    chat,
    runs,
    sandbox,
    push,
    outbox,
    model,
    enqueued,
    agent,
    user,
    uploadFile,
    task,
    run,
    reply,
    events,
    priceTools,
    close: async () => {
      redis.disconnect();
      await conn.close();
    },
  };
}

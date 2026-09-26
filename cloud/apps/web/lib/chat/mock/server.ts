/**
 * In-memory DJL Cloud chat API for local development, component tests, and
 * Playwright. Enabled in the browser only with NEXT_PUBLIC_DJL_MOCK_API=true.
 *
 * - Seeded from the contract fixtures in packages/contracts/fixtures/cloud.
 * - Paths, status codes, and error codes follow cloud/apps/api's routes.
 * - Every request body is decoded with its contract input schema (400 on
 *   mismatch) and every response is checked against its response schema, so
 *   the client cannot drift from the contract.
 * - Mutations need the CSRF token from GET /v1/csrf, like cookie requests to the API.
 * - Uploads are verified on complete (size and SHA-256) like the API does.
 * - Runs are scripted event logs released over time, served as SSE with
 *   `after=<seq>` resume, exactly like the real run endpoints.
 */
import * as C from "@synara/contracts/cloud";
import conversationDetailFixture from "@synara/contracts/fixtures/cloud/conversation-detail.json";
import meFixture from "@synara/contracts/fixtures/cloud/me.json";
import modelsFixture from "@synara/contracts/fixtures/cloud/models.json";
import usageWindowsFixture from "@synara/contracts/fixtures/cloud/usage-windows.json";
import { Schema } from "effect";

import type { FetchLike } from "../client";
import { formatSse } from "../sse";
import { chatReply, generatedImageDataUrl, taskSummary, wantsImage } from "./content";

type Enc<S extends { readonly Encoded: unknown }> = S["Encoded"];
type Conversation = {
  -readonly [K in keyof Enc<typeof C.CloudConversation>]: Enc<typeof C.CloudConversation>[K];
};
type Message = Enc<typeof C.CloudMessage>;
type Part = Enc<typeof C.CloudMessagePart>;
type Run = Enc<typeof C.CloudRun>;
type RunEvent = Enc<typeof C.CloudRunEvent>;
type Model = Enc<typeof C.CloudModel>;
type Bank = Enc<typeof C.CloudResetBank>;

interface ScriptStep {
  /** Milliseconds after the run starts. */
  readonly at: number;
  readonly type: RunEvent["type"];
  readonly payload: unknown;
}

interface MockRun {
  readonly run: Run;
  readonly script: readonly ScriptStep[];
  readonly startedAt: number;
  cancelledAt: number | null;
  settledMicro: number;
  counted: boolean;
}

interface MockFile {
  file: Enc<typeof C.CloudFile>;
  /** Declared at POST /v1/files; checked on complete. */
  sha256: string;
  /** The uploaded bytes' hash and size, once PUT. */
  uploaded: { sha256: string; size: number } | null;
  url: string | null;
}

interface MockShare {
  share: Enc<typeof C.CloudShare>;
  token: string;
  messages: Enc<typeof C.CloudSharedMessage>[];
}

export interface MockDb {
  nextId: number;
  conversations: Conversation[];
  messages: Message[];
  runs: MockRun[];
  files: Record<string, MockFile>;
  shares: MockShare[];
  usage: {
    planId: C.CloudPlanId;
    fiveHourLimit: number;
    weekLimit: number;
    fiveHourUsed: number;
    weekUsed: number;
    fiveHourResetsAt: string | null;
    weekResetsAt: string | null;
    banks: Bank[];
  };
  sent: Record<string, Enc<typeof C.CloudSendMessageResponse>>;
  redeemed: Record<string, Enc<typeof C.CloudRedeemBankResponse>>;
}

export type MockScenario = "default" | "exhausted" | "empty";

export interface MockApiOptions {
  readonly baseUrl: string;
  readonly now?: () => number;
  /** Delay between streamed events. */
  readonly tickMs?: number;
  /** Simulated network latency for JSON requests. */
  readonly latencyMs?: number;
  readonly scenario?: MockScenario;
  /** Where public share URLs point. */
  readonly appOrigin?: string;
  /** Persist the database here (the browser mock uses localStorage). */
  readonly persist?: { load(): MockDb | null; save(db: MockDb): void };
}

export interface MockFaults {
  /** Close the next opened event stream after this many events (simulates a dropped connection). */
  dropStreamAfter: number | null;
  /** Fail the next matching requests before they reach a handler. */
  failNext: Array<{ method: string; path: RegExp; status: number | "network"; code?: string }>;
}

export interface MockApi {
  readonly fetch: FetchLike;
  readonly db: MockDb;
  readonly faults: MockFaults;
  /** The double-submit token mutations must send; change it to simulate a rotated cookie. */
  readonly csrf: { token: string };
  readonly requests: Array<{ method: string; path: string; body: unknown; csrf: string | null }>;
}

const DAY = 86_400_000;
const REPLY_COST_MICRO = 3_000_000;
const IMAGE_COST_MICRO = 8_000_000;
const TASK_COST_MICRO = 12_000_000;

const extraModels: Model[] = [
  {
    id: "claude-sonnet",
    provider: "anthropic",
    displayName: "Claude Sonnet",
    capabilities: ["text.chat", "tools", "vision"],
    price: { inputPer1k: "0.30", outputPer1k: "1.50", perImage: "0.00" },
    contextWindow: 200000,
    maxOutputTokens: 64000,
    status: "active",
  },
  {
    id: "gpt-image-1",
    provider: "openai",
    displayName: "GPT Image",
    capabilities: ["image.generate"],
    price: { inputPer1k: "0.00", outputPer1k: "0.00", perImage: "4.00" },
    contextWindow: null,
    maxOutputTokens: null,
    status: "active",
  },
  {
    id: "fast-mini",
    provider: "openrouter",
    displayName: "Fast Mini",
    capabilities: ["text.chat", "json"],
    price: { inputPer1k: "0.02", outputPer1k: "0.08", perImage: "0.00" },
    contextWindow: 128000,
    maxOutputTokens: 16000,
    status: "degraded",
  },
];

export const MOCK_MODELS: readonly Model[] = [
  ...(modelsFixture as Enc<typeof C.CloudModelsResponse>).models,
  ...extraModels,
];

function iso(ms: number) {
  return new Date(ms).toISOString();
}

export function seedDb(now: number, scenario: MockScenario): MockDb {
  const detail = conversationDetailFixture as Enc<typeof C.CloudConversationDetailResponse>;
  const usage = usageWindowsFixture as Enc<typeof C.CloudUsageWindowsResponse>;
  const ago = (ms: number) => iso(now - ms);
  const conversations: Conversation[] =
    scenario === "empty"
      ? []
      : [
          {
            ...detail.conversation,
            pinned: true,
            lastMessageAt: ago(3 * DAY),
            createdAt: ago(3 * DAY),
            updatedAt: ago(3 * DAY),
          },
          conv("conv_seed_2", "Quarterly report outline", ago(2 * 3_600_000)),
          conv("conv_seed_3", "Regex for email validation", ago(2 * DAY)),
          conv("conv_seed_4", "Weekend hiking checklist", ago(5 * DAY)),
          conv("conv_seed_5", "Explain vector databases", ago(20 * DAY)),
          { ...conv("conv_seed_6", "Old brainstorm", ago(40 * DAY)), archived: true },
        ];
  const messages: Message[] = [];
  if (scenario !== "empty") {
    for (const m of detail.messages) messages.push({ ...m, createdAt: ago(3 * DAY) });
    for (const c of conversations.slice(1)) {
      messages.push(
        msg(`${c.id}_u`, c.id, null, "user", [{ type: "text", text: c.title ?? "" }], c.updatedAt),
        msg(
          `${c.id}_a`,
          c.id,
          `${c.id}_u`,
          "assistant",
          [{ type: "text", text: chatReply(c.title ?? "", 1) }],
          c.updatedAt,
          "gpt-5",
        ),
      );
    }
  }
  const exhausted = scenario === "exhausted";
  const fiveHourLimit = Number(usage.windows.fiveHour.limit);
  return {
    nextId: 1,
    conversations,
    messages,
    runs: [],
    files: {
      file_1: {
        file: {
          id: "file_1",
          name: "itinerary.pdf",
          mimeType: "application/pdf",
          size: 48213,
          status: "ready",
          createdAt: ago(3 * DAY),
        },
        sha256: "",
        uploaded: null,
        url: "data:text/plain;charset=utf-8,Mock%20itinerary",
      },
      file_2: {
        file: {
          id: "file_2",
          name: "kyoto.svg",
          mimeType: "image/svg+xml",
          size: 2048,
          status: "ready",
          createdAt: ago(3 * DAY),
        },
        sha256: "",
        uploaded: null,
        url: generatedImageDataUrl(3, "Kyoto"),
      },
    },
    shares: [],
    usage: {
      planId: usage.planId,
      fiveHourLimit,
      weekLimit: Number(usage.windows.week.limit),
      fiveHourUsed: exhausted ? fiveHourLimit : Number(usage.windows.fiveHour.used),
      weekUsed: Number(usage.windows.week.used),
      fiveHourResetsAt: iso(now + 2 * 3_600_000 + 14 * 60_000),
      weekResetsAt: iso(now + 4 * DAY),
      banks: [
        {
          id: "bank_1",
          source: "plan_schedule" as const,
          grantedAt: ago(10 * DAY),
          expiresAt: iso(now + 80 * DAY),
        },
        {
          id: "bank_2",
          source: "admin" as const,
          grantedAt: ago(2 * DAY),
          expiresAt: iso(now + 88 * DAY),
        },
      ],
    },
    sent: {},
    redeemed: {},
  };
}

function conv(id: string, title: string, at: string): Conversation {
  return {
    id,
    title,
    pinned: false,
    archived: false,
    lastMessageAt: at,
    createdAt: at,
    updatedAt: at,
  };
}

function msg(
  id: string,
  conversationId: string,
  parentId: string | null,
  role: "user" | "assistant",
  parts: Part[],
  createdAt: string,
  model: string | null = null,
  runId: string | null = null,
): Message {
  return { id, conversationId, parentId, role, parts, model, runId, createdAt };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly resetsAt?: string,
  ) {
    super(message);
  }
}

function decode<S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
): S["Encoded"] {
  try {
    Schema.decodeUnknownSync(schema as unknown as Schema.Codec<unknown, unknown>)(value);
  } catch (e) {
    throw new HttpError(400, "bad_request", e instanceof Error ? e.message : "Invalid request");
  }
  return value as S["Encoded"];
}

/** Asserts a response matches its contract schema before it is sent. A failure is a bug in the mock. */
function checked<S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: S["Encoded"],
) {
  Schema.decodeUnknownSync(schema as unknown as Schema.Codec<unknown, unknown>)(value);
  return value;
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

export function createMockApi(options: MockApiOptions): MockApi {
  const now = options.now ?? Date.now;
  const tick = options.tickMs ?? 35;
  const latency = options.latencyMs ?? 0;
  const appOrigin = options.appOrigin ?? "https://app.slcor.com";
  const db = options.persist?.load() ?? seedDb(now(), options.scenario ?? "default");
  const faults: MockFaults = { dropStreamAfter: null, failNext: [] };
  const csrf = { token: "mock-csrf-token-mock-csrf-token-mock-csrf-t" };
  const requests: MockApi["requests"] = [];
  const save = () => options.persist?.save(db);

  const id = (prefix: string) => `${prefix}_${now().toString(36)}${(db.nextId++).toString(36)}`;

  // --- runs -------------------------------------------------------------------

  function eventsOf(r: MockRun): RunEvent[] {
    const elapsed = now() - r.startedAt;
    const cutoff =
      r.cancelledAt === null ? elapsed : Math.min(elapsed, r.cancelledAt - r.startedAt);
    const released = r.script.filter((s) => s.at <= cutoff);
    const events = released.map(
      (s, i) =>
        ({
          runId: r.run.id,
          seq: i + 1,
          type: s.type,
          payload: s.payload,
          createdAt: iso(r.startedAt + s.at),
        }) as RunEvent,
    );
    const finished = released.length === r.script.length;
    if (r.cancelledAt !== null && !finished)
      events.push({
        runId: r.run.id,
        seq: events.length + 1,
        type: "status",
        payload: { status: "cancelled", error: null },
        createdAt: iso(r.cancelledAt),
      });
    return events;
  }

  function runView(r: MockRun): Run {
    const events = eventsOf(r);
    let status: Run["status"] = "queued";
    for (const e of events) if (e.type === "status") status = e.payload.status;
    const terminal = TERMINAL.has(status);
    if (terminal && !r.counted) {
      r.counted = true;
      db.usage.fiveHourUsed += r.settledMicro;
      db.usage.weekUsed += r.settledMicro;
      save();
    }
    return {
      ...r.run,
      status,
      lastSeq: events.length,
      finishedAt: terminal ? (events[events.length - 1]?.createdAt ?? null) : null,
    };
  }

  function partsOf(r: MockRun): Part[] {
    let parts: Part[] = [];
    for (const e of eventsOf(r)) {
      if (e.type === "text.delta") {
        const last = parts[parts.length - 1];
        if (last?.type === "text")
          parts = [...parts.slice(0, -1), { type: "text", text: last.text + e.payload.text }];
        else parts.push({ type: "text", text: e.payload.text });
      } else if (e.type === "message.part") parts.push(e.payload.part);
    }
    return parts;
  }

  function messageView(m: Message): Message {
    if (m.role !== "assistant" || !m.runId) return m;
    const r = db.runs.find((x) => x.run.id === m.runId);
    return r ? { ...m, parts: partsOf(r) } : m;
  }

  function buildScript(
    runId: string,
    replyId: string,
    mode: "chat" | "task",
    model: Model | undefined,
    prompt: string,
    variant: number,
  ): { script: ScriptStep[]; cost: number } {
    const steps: ScriptStep[] = [];
    let at = tick * 4;
    const push = (type: RunEvent["type"], payload: unknown, gap = tick) => {
      steps.push({ at, type, payload });
      at += gap;
    };
    const text = (t: string) => {
      for (const chunk of textChunks(t)) push("text.delta", { messageId: replyId, text: chunk });
    };
    const usage = (cost: number) =>
      push("usage", {
        requestId: `req_${runId}`,
        model: model?.id ?? "gpt-5",
        routeReason: "model",
        inputTokens: 900 + prompt.length,
        outputTokens: 400,
        settled: String(cost),
        remaining: "1999000000",
        cutOff: false,
      });
    push("status", { status: "running", error: null });

    if (mode === "task") {
      const tool = (step: number, name: string, args: unknown, result: string) => {
        push("step.started", { step, maxSteps: 25 }, tick * 3);
        const callId = `call_${runId}_${step}`;
        push(
          "message.part",
          {
            messageId: replyId,
            part: { type: "tool_call", toolCallId: callId, name, arguments: JSON.stringify(args) },
          },
          tick * 12,
        );
        push(
          "message.part",
          {
            messageId: replyId,
            part: {
              type: "tool_result",
              toolCallId: callId,
              name,
              content: result,
              isError: false,
            },
          },
          tick * 3,
        );
      };
      tool(
        1,
        "web_search",
        { query: prompt.slice(0, 80) },
        "5 results\nhttps://en.wikipedia.org/wiki/Research\nhttps://www.nature.com/articles/example\nhttps://developer.mozilla.org/en-US/docs/Web",
      );
      tool(
        2,
        "read_page",
        { url: "https://en.wikipedia.org/wiki/Research" },
        "Read 2,340 words from en.wikipedia.org",
      );
      tool(3, "python", { code: "totals = [12, 30, 58]\nprint(sum(totals))" }, "100");
      push("step.started", { step: 4, maxSteps: 25 }, tick * 3);
      text(taskSummary(prompt));
      usage(TASK_COST_MICRO);
      push("status", { status: "succeeded", error: null });
      return { script: steps, cost: TASK_COST_MICRO };
    }

    if (model?.capabilities.includes("image.generate") || wantsImage(prompt)) {
      const fileId = id("file");
      db.files[fileId] = {
        file: {
          id: fileId,
          name: "generated.svg",
          mimeType: "image/svg+xml",
          size: 4096,
          status: "ready",
          createdAt: iso(now()),
        },
        sha256: "",
        uploaded: null,
        url: generatedImageDataUrl(db.nextId + variant, prompt.slice(0, 40)),
      };
      text("Here's the image. ");
      push(
        "message.part",
        {
          messageId: replyId,
          part: { type: "image_ref", fileId, mimeType: "image/svg+xml", width: 1024, height: 1024 },
        },
        tick * 10,
      );
      text("Want any changes to the colors or composition?");
      usage(IMAGE_COST_MICRO);
      push("status", { status: "succeeded", error: null });
      return { script: steps, cost: IMAGE_COST_MICRO };
    }

    text(chatReply(prompt, variant));
    usage(REPLY_COST_MICRO);
    push("status", { status: "succeeded", error: null });
    return { script: steps, cost: REPLY_COST_MICRO };
  }

  function startRun(
    conversationId: string,
    parent: Message,
    modelId: string,
    mode: "chat" | "task",
  ) {
    const siblings = db.messages.filter(
      (m) => m.parentId === parent.id && m.role === "assistant",
    ).length;
    const replyId = id("msg");
    const runId = id("run");
    const at = iso(now());
    const reply = msg(replyId, conversationId, parent.id, "assistant", [], at, modelId, runId);
    const prompt = parent.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ");
    const model = MOCK_MODELS.find((m) => m.id === modelId);
    const { script, cost } = buildScript(runId, replyId, mode, model, prompt, siblings);
    const r: MockRun = {
      run: {
        id: runId,
        conversationId,
        messageId: replyId,
        mode,
        status: "queued",
        model: modelId,
        error: null,
        lastSeq: 0,
        createdAt: at,
        finishedAt: null,
      },
      script,
      startedAt: now(),
      cancelledAt: null,
      settledMicro: cost,
      counted: false,
    };
    db.messages.push(reply);
    db.runs.push(r);
    return { reply, run: runView(r) };
  }

  // --- usage --------------------------------------------------------------------

  /** Live banks, oldest first; redeeming uses the oldest. */
  const liveBanks = () =>
    db.usage.banks
      .filter((b) => Date.parse(b.expiresAt) > now())
      .toSorted((a, b) => a.grantedAt.localeCompare(b.grantedAt));

  function usageWindows(): Enc<typeof C.CloudUsageWindowsResponse> {
    const u = db.usage;
    const banks = liveBanks();
    return {
      planId: u.planId,
      windows: {
        fiveHour: win("five_hour", u.fiveHourLimit, u.fiveHourUsed, u.fiveHourResetsAt),
        week: win("week", u.weekLimit, u.weekUsed, u.weekResetsAt),
      },
      banks: { count: banks.length, nextExpiresAt: banks[0]?.expiresAt ?? null },
    };
  }

  function assertUsageAvailable() {
    const u = db.usage;
    if (u.fiveHourUsed >= u.fiveHourLimit)
      throw new HttpError(
        429,
        "usage_window_exhausted",
        "You've reached your 5-hour limit.",
        u.fiveHourResetsAt ?? undefined,
      );
    if (u.weekUsed >= u.weekLimit)
      throw new HttpError(
        429,
        "usage_window_exhausted",
        "You've reached your weekly limit.",
        u.weekResetsAt ?? undefined,
      );
  }

  // --- helpers ------------------------------------------------------------------

  const findConversation = (cid: string) => {
    const c = db.conversations.find((x) => x.id === cid);
    if (!c) throw new HttpError(404, "not_found", "Conversation not found");
    return c;
  };
  const findRun = (rid: string) => {
    const r = db.runs.find((x) => x.run.id === rid);
    if (!r) throw new HttpError(404, "not_found", "Run not found");
    return r;
  };
  const textOf = (m: Message) =>
    messageView(m)
      .parts.map((p) => (p.type === "text" ? p.text : ""))
      .join(" ");

  function branchTo(messageId: string): Message[] {
    const chain: Message[] = [];
    let cur = db.messages.find((m) => m.id === messageId);
    while (cur) {
      chain.unshift(messageView(cur));
      const parentId: string | null = cur.parentId;
      cur = parentId ? db.messages.find((m) => m.id === parentId) : undefined;
    }
    return chain;
  }

  // --- event stream -------------------------------------------------------------

  function streamResponse(
    r: MockRun,
    after: number,
    signal: AbortSignal | null | undefined,
  ): Response {
    const encoder = new TextEncoder();
    let dropAfter = faults.dropStreamAfter;
    faults.dropStreamAfter = null;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let sent = after;
        const abort = () => {
          try {
            controller.error(new DOMException("The operation was aborted.", "AbortError"));
          } catch {
            /* already closed */
          }
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        for (;;) {
          if (signal?.aborted) return;
          const events = eventsOf(r);
          for (const e of events) {
            if (e.seq <= sent) continue;
            controller.enqueue(encoder.encode(formatSse(e.type, e, e.seq)));
            sent = e.seq;
            if (dropAfter !== null && --dropAfter <= 0) {
              signal?.removeEventListener("abort", abort);
              controller.close();
              return;
            }
          }
          if (TERMINAL.has(runView(r).status)) {
            signal?.removeEventListener("abort", abort);
            controller.close();
            return;
          }
          await new Promise((res) => setTimeout(res, Math.max(5, tick / 2)));
        }
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  // --- router -------------------------------------------------------------------

  type Handler = (
    m: RegExpMatchArray,
    body: unknown,
    url: URL,
    init: RequestInit | undefined,
  ) => unknown;
  const routes: Array<[string, RegExp, Handler]> = [
    [
      "GET",
      /^\/v1\/me$/,
      () => checked(C.CloudMeResponse, meFixture as Enc<typeof C.CloudMeResponse>),
    ],
    ["GET", /^\/v1\/models$/, () => checked(C.CloudModelsResponse, { models: [...MOCK_MODELS] })],
    ["GET", /^\/v1\/csrf$/, () => checked(C.CloudCsrfResponse, { token: csrf.token })],
    ["GET", /^\/v1\/usage\/windows$/, () => checked(C.CloudUsageWindowsResponse, usageWindows())],
    [
      "GET",
      /^\/v1\/usage\/banks$/,
      () => checked(C.CloudResetBanksResponse, { banks: liveBanks() }),
    ],
    [
      "POST",
      /^\/v1\/usage\/resets\/redeem$/,
      (_m, body) => {
        const { idempotencyKey } = decode(C.CloudRedeemBankInput, body);
        const prior = db.redeemed[idempotencyKey];
        if (prior) return prior;
        const bank = liveBanks()[0];
        if (!bank) throw new HttpError(409, "no_reset_bank", "You have no banked resets to use.");
        db.usage.banks = db.usage.banks.filter((b) => b.id !== bank.id);
        db.usage.fiveHourUsed = 0;
        db.usage.weekUsed = 0;
        db.usage.weekResetsAt = iso(now() + 7 * DAY);
        const res = checked(C.CloudRedeemBankResponse, {
          redeemedBankId: bank.id,
          usage: usageWindows(),
        });
        db.redeemed[idempotencyKey] = res;
        return res;
      },
    ],
    [
      "GET",
      /^\/v1\/conversations$/,
      (_m, _b, url) => {
        const archived = url.searchParams.get("archived") === "true";
        // Pinned first, then most recent, like the API.
        const conversations = db.conversations
          .filter((c) => c.archived === archived)
          .toSorted(
            (a, b) =>
              Number(b.pinned) - Number(a.pinned) || b.lastMessageAt.localeCompare(a.lastMessageAt),
          );
        return checked(C.CloudConversationListResponse, { conversations, nextCursor: null });
      },
    ],
    [
      "POST",
      /^\/v1\/conversations$/,
      (_m, body) => {
        const input = decode(C.CloudCreateConversationInput, body ?? {});
        const at = iso(now());
        const c = { ...conv(id("conv"), input.title ?? "", at), title: input.title ?? null };
        db.conversations.push(c);
        return json(201, checked(C.CloudCreateConversationResponse, c));
      },
    ],
    [
      "GET",
      /^\/v1\/conversations\/search$/,
      (_m, _b, url) => {
        const { q } = decode(C.CloudConversationSearchQuery, {
          q: url.searchParams.get("q") ?? "",
        });
        const needle = q.toLowerCase();
        const results: Enc<typeof C.CloudConversationSearchHit>[] = [];
        for (const c of db.conversations) {
          // The newest matching message, like the API.
          const hit = db.messages.findLast(
            (m) => m.conversationId === c.id && textOf(m).toLowerCase().includes(needle),
          );
          if (hit) {
            const text = textOf(hit);
            const i = text.toLowerCase().indexOf(needle);
            results.push({
              conversation: c,
              messageId: hit.id,
              snippet: text.slice(Math.max(0, i - 40), i + needle.length + 60).trim(),
            });
          } else if ((c.title ?? "").toLowerCase().includes(needle)) {
            results.push({ conversation: c, messageId: null, snippet: c.title ?? "" });
          }
        }
        return checked(C.CloudConversationSearchResponse, { results, nextCursor: null });
      },
    ],
    [
      "GET",
      /^\/v1\/conversations\/([^/]+)$/,
      (m) => {
        const c = findConversation(decodeURIComponent(m[1]!));
        const messages = db.messages.filter((x) => x.conversationId === c.id).map(messageView);
        return checked(C.CloudConversationDetailResponse, { conversation: c, messages });
      },
    ],
    [
      "PATCH",
      /^\/v1\/conversations\/([^/]+)$/,
      (m, body) => {
        const c = findConversation(decodeURIComponent(m[1]!));
        const input = decode(C.CloudUpdateConversationInput, body);
        if (input.title !== undefined) c.title = input.title;
        if (input.pinned !== undefined) c.pinned = input.pinned;
        if (input.archived !== undefined) c.archived = input.archived;
        return checked(C.CloudUpdateConversationResponse, c);
      },
    ],
    [
      "DELETE",
      /^\/v1\/conversations\/([^/]+)$/,
      (m) => {
        const c = findConversation(decodeURIComponent(m[1]!));
        db.conversations = db.conversations.filter((x) => x.id !== c.id);
        db.messages = db.messages.filter((x) => x.conversationId !== c.id);
        return null;
      },
    ],
    [
      "POST",
      /^\/v1\/conversations\/([^/]+)\/messages$/,
      (m, body) => {
        const c = findConversation(decodeURIComponent(m[1]!));
        const input = decode(C.CloudSendMessageInput, body);
        const prior = db.sent[`${c.id}:${input.clientMessageId}`];
        if (prior) return prior;
        if (
          input.parentId &&
          !db.messages.some((x) => x.id === input.parentId && x.conversationId === c.id)
        )
          throw new HttpError(400, "bad_request", "Unknown parent message");
        assertUsageAvailable();
        const at = iso(now());
        const message = msg(id("msg"), c.id, input.parentId, "user", [...input.parts], at);
        db.messages.push(message);
        const { reply, run } = startRun(c.id, message, input.model, input.mode);
        c.updatedAt = at;
        c.lastMessageAt = at;
        if (!c.title) {
          const firstText = input.parts.find((p) => p.type === "text");
          c.title = (firstText?.type === "text" ? firstText.text : "New chat").slice(0, 60);
        }
        const res = checked(C.CloudSendMessageResponse, { message, reply, run });
        db.sent[`${c.id}:${input.clientMessageId}`] = res;
        return json(201, res);
      },
    ],
    [
      "POST",
      /^\/v1\/conversations\/([^/]+)\/messages\/([^/]+)\/regenerate$/,
      (m, body) => {
        const c = findConversation(decodeURIComponent(m[1]!));
        const input = decode(C.CloudRegenerateInput, body ?? {});
        // Only an assistant reply can be regenerated; anything else is a 404, like the API.
        const target = db.messages.find(
          (x) =>
            x.id === decodeURIComponent(m[2]!) &&
            x.conversationId === c.id &&
            x.role === "assistant",
        );
        const parent = target && db.messages.find((x) => x.id === target.parentId);
        if (!target || !parent) throw new HttpError(404, "not_found", "Not found.");
        assertUsageAvailable();
        const { reply, run } = startRun(
          c.id,
          parent,
          input.model ?? target.model ?? "gpt-5",
          runMode(target),
        );
        c.updatedAt = iso(now());
        c.lastMessageAt = c.updatedAt;
        return json(
          201,
          checked(C.CloudRegenerateResponse, { message: messageView(parent), reply, run }),
        );
      },
    ],
    [
      "GET",
      /^\/v1\/runs\/([^/]+)$/,
      (m) => checked(C.CloudRunResponse, { run: runView(findRun(decodeURIComponent(m[1]!))) }),
    ],
    [
      "POST",
      /^\/v1\/runs\/([^/]+)\/cancel$/,
      (m) => {
        const r = findRun(decodeURIComponent(m[1]!));
        if (!TERMINAL.has(runView(r).status)) r.cancelledAt = now();
        return checked(C.CloudRunResponse, { run: runView(r) });
      },
    ],
    [
      "GET",
      /^\/v1\/runs\/([^/]+)\/events$/,
      (m, _b, url, init) => {
        const r = findRun(decodeURIComponent(m[1]!));
        const after = Number(url.searchParams.get("after") ?? "0");
        const accept = new Headers(init?.headers).get("accept") ?? "";
        if (accept.includes("text/event-stream")) return streamResponse(r, after, init?.signal);
        return checked(C.CloudRunEventsResponse, {
          run: runView(r),
          events: eventsOf(r).filter((e) => e.seq > after),
        });
      },
    ],
    [
      "POST",
      /^\/v1\/files$/,
      (_m, body) => {
        const input = decode(C.CloudFilePresignInput, body);
        if (input.purpose === "image" && !input.mimeType.startsWith("image/"))
          throw new HttpError(400, "unsupported_type", "Images must be PNG, JPEG, GIF, or WebP.");
        const fileId = id("file");
        const file = {
          id: fileId,
          name: input.name,
          mimeType: input.mimeType,
          size: input.size,
          status: "pending" as const,
          createdAt: iso(now()),
        };
        db.files[fileId] = { file, sha256: input.sha256, uploaded: null, url: null };
        return json(
          201,
          checked(C.CloudFilePresignResponse, {
            file,
            upload: {
              url: `${options.baseUrl}/__mock_storage__/${fileId}`,
              method: "PUT",
              headers: { "content-type": input.mimeType, "content-length": String(input.size) },
              expiresAt: iso(now() + 15 * 60_000),
            },
          }),
        );
      },
    ],
    [
      "POST",
      /^\/v1\/files\/([^/]+)\/complete$/,
      (m) => {
        const f = db.files[decodeURIComponent(m[1]!)];
        if (!f) throw new HttpError(404, "not_found", "Not found.");
        if (f.file.status === "ready") return checked(C.CloudFile, f.file);
        if (f.file.status !== "pending")
          throw new HttpError(400, "upload_rejected", "This upload was rejected.");
        if (!f.uploaded || !f.url)
          throw new HttpError(400, "upload_missing", "Upload the file before completing it.");
        if (f.uploaded.size !== f.file.size || f.uploaded.sha256 !== f.sha256) {
          f.file = { ...f.file, status: "rejected" };
          f.url = null;
          throw new HttpError(
            400,
            "upload_mismatch",
            "The uploaded file does not match what was declared.",
          );
        }
        f.file = { ...f.file, status: "ready" };
        return checked(C.CloudFile, f.file);
      },
    ],
    [
      "GET",
      /^\/v1\/files\/([^/]+)\/url$/,
      (m) => {
        const f = db.files[decodeURIComponent(m[1]!)];
        if (!f?.url || f.file.status !== "ready")
          throw new HttpError(404, "not_found", "Not found.");
        return checked(C.CloudFileDownloadResponse, {
          url: f.url,
          expiresAt: iso(now() + 5 * 60_000),
        });
      },
    ],
    [
      "POST",
      /^\/v1\/conversations\/([^/]+)\/shares$/,
      (m, body) => {
        const c = findConversation(decodeURIComponent(m[1]!));
        const input = decode(C.CloudCreateShareInput, body ?? {});
        // Without a messageId the API snapshots the branch on screen; the mock uses the newest message.
        const leafId =
          input.messageId ?? db.messages.findLast((x) => x.conversationId === c.id)?.id;
        if (!leafId) throw new HttpError(404, "not_found", "Not found.");
        const token = `tok_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
        const share = {
          id: id("share"),
          conversationId: c.id,
          title: c.title,
          createdAt: iso(now()),
          revokedAt: null,
        };
        const messages = branchTo(leafId)
          .filter((x) => x.parts.length > 0)
          .map((x) => ({ role: x.role, parts: x.parts, createdAt: x.createdAt }));
        db.shares.push({ share, token, messages });
        return json(
          201,
          checked(C.CloudCreateShareResponse, { share, url: `${appOrigin}/share/${token}` }),
        );
      },
    ],
    [
      "GET",
      /^\/v1\/shares$/,
      () => checked(C.CloudShareListResponse, { shares: db.shares.map((s) => s.share) }),
    ],
    [
      "DELETE",
      /^\/v1\/shares\/([^/]+)$/,
      (m) => {
        const s = db.shares.find((x) => x.share.id === decodeURIComponent(m[1]!));
        if (!s) throw new HttpError(404, "not_found", "Not found.");
        s.share = { ...s.share, revokedAt: s.share.revokedAt ?? iso(now()) };
        return checked(C.CloudRevokeShareResponse, { share: s.share });
      },
    ],
    [
      "GET",
      /^\/v1\/public\/shares\/([^/]+)$/,
      (m) => {
        const s = db.shares.find(
          (x) => x.token === decodeURIComponent(m[1]!) && x.share.revokedAt === null,
        );
        if (!s) throw new HttpError(404, "not_found", "Not found.");
        // Signed URLs for the snapshot's images only, like the API.
        const imageUrls: Record<string, string> = {};
        for (const message of s.messages)
          for (const p of message.parts) {
            const url = p.type === "image_ref" ? db.files[p.fileId]?.url : null;
            if (url && p.type === "image_ref") imageUrls[p.fileId] = url;
          }
        return checked(C.CloudPublicShareResponse, {
          title: s.share.title,
          createdAt: s.share.createdAt,
          messages: s.messages,
          imageUrls,
        });
      },
    ],
  ];

  function runMode(message: Message): "chat" | "task" {
    return db.runs.find((r) => r.run.id === message.runId)?.run.mode ?? "chat";
  }

  async function storagePut(fileId: string, init: RequestInit | undefined): Promise<Response> {
    const f = db.files[fileId];
    if (!f) return new Response(null, { status: 404 });
    const blob = init?.body instanceof Blob ? init.body : new Blob([String(init?.body ?? "")]);
    const declared = new Headers(init?.headers).get("content-type");
    if (declared !== f.file.mimeType) return new Response(null, { status: 403 });
    f.uploaded = { sha256: await sha256Hex(blob), size: blob.size };
    f.url = blob.size < 1_500_000 ? await toDataUrl(blob, f.file.mimeType) : objectUrl(blob);
    save();
    return new Response(null, { status: 200 });
  }

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input, options.baseUrl);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(new URL(options.baseUrl).pathname.replace(/\/$/, ""), "");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const presentedCsrf = new Headers(init?.headers).get(C.CLOUD_CSRF_HEADER);
    requests.push({ method, path: `${path}${url.search}`, body, csrf: presentedCsrf });
    if (latency > 0) await new Promise((r) => setTimeout(r, latency));
    const faultIndex = faults.failNext.findIndex((f) => f.method === method && f.path.test(path));
    if (faultIndex !== -1) {
      const [fault] = faults.failNext.splice(faultIndex, 1);
      if (fault!.status === "network") throw new TypeError("Failed to fetch");
      return json(fault!.status, {
        error: { code: fault!.code ?? "internal", message: "Injected failure", traceId: "mock" },
      });
    }
    const storage = path.match(/^\/__mock_storage__\/([^/]+)$/);
    if (storage && method === "PUT") return storagePut(storage[1]!, init);
    if (method !== "GET" && presentedCsrf !== csrf.token)
      return json(403, {
        error: { code: "csrf_token", message: "Refresh the page and try again.", traceId: "mock" },
      });
    for (const [m, re, handler] of routes) {
      if (m !== method) continue;
      const match = path.match(re);
      if (!match) continue;
      try {
        const result = await handler(match, body, url, init);
        save();
        if (result instanceof Response) return result;
        return result === null ? new Response(null, { status: 204 }) : json(200, result);
      } catch (e) {
        if (e instanceof HttpError)
          return json(e.status, {
            error: {
              code: e.code,
              message: e.message,
              traceId: "mock",
              ...(e.resetsAt ? { resetsAt: e.resetsAt } : {}),
            },
          });
        throw e;
      }
    }
    return json(404, {
      error: { code: "not_found", message: `No mock for ${method} ${path}`, traceId: "mock" },
    });
  };

  return { fetch, db, faults, csrf, requests };
}

/** Splits text into three-word chunks so replies stream like a model's output. */
function textChunks(text: string): string[] {
  return (
    text.match(/\S+\s*|\s+/g)?.reduce<string[]>((acc, word, i) => {
      if (i % 3 === 0) acc.push(word);
      else acc[acc.length - 1] += word;
      return acc;
    }, []) ?? [text]
  );
}

function win(kind: "five_hour" | "week", limit: number, used: number, resetsAt: string | null) {
  return {
    kind,
    limit: String(limit),
    used: String(Math.min(used, limit)),
    remaining: String(Math.max(0, limit - used)),
    resetsAt: used > 0 ? resetsAt : null,
  };
}

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function toDataUrl(blob: Blob, mimeType: string): Promise<string> {
  return blob.arrayBuffer().then((buf) => {
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${mimeType};base64,${btoa(binary)}`;
  });
}

function objectUrl(blob: Blob): string {
  try {
    return URL.createObjectURL(blob);
  } catch {
    return "about:blank";
  }
}

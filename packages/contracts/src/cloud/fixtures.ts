/**
 * Example payloads for the DJL Cloud contract. `bun run fixtures:cloud` (in
 * packages/contracts) encodes each through its schema and writes it to
 * `fixtures/cloud/<name>.json`, where native clients decode them in their own
 * tests to catch drift from these schemas.
 */
import { Schema } from "effect";

import { CloudDeleteAccountResponse, CloudMeResponse, CloudRunPushData } from "./account";
import { CloudAccessTokenResponse, CloudCsrfResponse } from "./base";
import {
  CloudConversation,
  CloudConversationDetailResponse,
  CloudConversationListResponse,
  CloudConversationMessagesResponse,
  CloudConversationSearchResponse,
} from "./chat";
import { CloudFile, CloudFileDownloadResponse, CloudFilePresignResponse } from "./files";
import { CloudNativeTokenResponse } from "./nativeAuth";
import { CloudRunEventsResponse, CloudRunResponse, CloudSendMessageResponse } from "./runs";
import {
  CloudCreateShareResponse,
  CloudPublicShareResponse,
  CloudRevokeShareResponse,
} from "./shares";
import {
  CloudCreditsResponse,
  CloudModelsResponse,
  CloudRedeemBankResponse,
  CloudResetBanksResponse,
  CloudUsageWindowsResponse,
} from "./usage";

type AnyCodec = Schema.Codec<unknown, unknown, never, never>;

const fixture = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  encoded: S["Encoded"],
) => ({ schema: schema as unknown as AnyCodec, encoded: encoded as unknown });

const at = "2026-09-26T12:00:00.000Z";
const later = "2026-09-26T17:00:00.000Z";

const conversation = {
  id: "conv_1",
  title: "Trip plan",
  pinned: false,
  archived: false,
  lastMessageAt: at,
  createdAt: at,
  updatedAt: at,
};

const run = {
  id: "run_1",
  conversationId: "conv_1",
  messageId: "msg_2",
  mode: "task",
  status: "running",
  model: "text.high",
  error: null,
  lastSeq: 5,
  createdAt: at,
  finishedAt: null,
} as const;

const usageWindows = {
  planId: "starter",
  windows: {
    fiveHour: {
      kind: "five_hour",
      limit: "150000000",
      used: "42000000",
      remaining: "108000000",
      resetsAt: later,
    },
    week: {
      kind: "week",
      limit: "750000000",
      used: "42000000",
      remaining: "708000000",
      resetsAt: "2026-10-03T12:00:00.000Z",
    },
  },
  banks: { count: 1, nextExpiresAt: "2026-12-25T12:00:00.000Z" },
} as const;

const share = {
  id: "share_1",
  conversationId: "conv_1",
  title: "Trip plan",
  createdAt: at,
  revokedAt: null,
};

export const cloudFixtures = {
  csrf: fixture(CloudCsrfResponse, { token: "Q2hhbmdlTWVDaGFuZ2VNZUNoYW5nZU1lQ2hhbmdlTWU" }),
  "access-token": fixture(CloudAccessTokenResponse, {
    token: "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyXzEiLCJzaWQiOiJzZXNzXzEifQ.c2ln",
  }),
  "account-delete": fixture(CloudDeleteAccountResponse, { deleted: true }),
  "run-push": fixture(CloudRunPushData, {
    source: "djl.cloudRun",
    runId: "run_1",
    conversationId: "conv_1",
    status: "succeeded",
    url: "djl://cloud/c/conv_1",
  }),
  conversation: fixture(CloudConversation, conversation),
  "conversation-list": fixture(CloudConversationListResponse, {
    conversations: [conversation],
    nextCursor: "WyJjdXJzb3IiXQ",
  }),
  "conversation-messages": fixture(CloudConversationMessagesResponse, {
    conversation,
    messages: [
      {
        id: "msg_1",
        conversationId: "conv_1",
        parentId: null,
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        model: null,
        runId: null,
        createdAt: at,
        siblingIds: ["msg_1"],
      },
      {
        id: "msg_2",
        conversationId: "conv_1",
        parentId: "msg_1",
        role: "assistant",
        parts: [{ type: "text", text: "Hi!" }],
        model: "gpt-5",
        runId: "run_1",
        createdAt: at,
        siblingIds: ["msg_2", "msg_3"],
      },
    ],
  }),
  run: fixture(CloudRunResponse, { run }),
  me: fixture(CloudMeResponse, {
    user: { id: "user_1", email: "ada@example.com", emailVerified: true },
    activeOrgId: "org_1",
    role: "owner",
    organizations: [{ id: "org_1", name: "Ada", slug: "ada", role: "owner", personal: true }],
  }),
  credits: fixture(CloudCreditsResponse, {
    orgId: "org_1",
    balances: { trial: "0", plan: "2000000000", topup: "0", free: "5000000" },
    total: "2005000000",
    display: { total: "2005.00", trial: "0.00", plan: "2000.00", topup: "0.00" },
  }),
  models: fixture(CloudModelsResponse, {
    models: [
      {
        id: "gpt-5",
        provider: "openai",
        displayName: "GPT-5",
        capabilities: ["text.chat", "tools", "vision", "json"],
        price: { inputPer1k: "0.18", outputPer1k: "1.40", perImage: "0.00" },
        contextWindow: 400000,
        maxOutputTokens: 128000,
        status: "active",
      },
    ],
  }),
  "usage-windows": fixture(CloudUsageWindowsResponse, usageWindows),
  "usage-banks": fixture(CloudResetBanksResponse, {
    banks: [
      {
        id: "bank_1",
        source: "plan_schedule",
        grantedAt: at,
        expiresAt: "2026-12-25T12:00:00.000Z",
      },
    ],
  }),
  "usage-redeem": fixture(CloudRedeemBankResponse, {
    redeemedBankId: "bank_1",
    usage: {
      ...usageWindows,
      windows: {
        fiveHour: {
          ...usageWindows.windows.fiveHour,
          used: "0",
          remaining: "150000000",
          resetsAt: null,
        },
        week: { ...usageWindows.windows.week, used: "0", remaining: "750000000", resetsAt: null },
      },
      banks: { count: 0, nextExpiresAt: null },
    },
  }),
  "conversation-detail": fixture(CloudConversationDetailResponse, {
    conversation,
    messages: [
      {
        id: "msg_1",
        conversationId: "conv_1",
        parentId: null,
        role: "user",
        parts: [
          { type: "text", text: "Plan three days in Kyoto from this itinerary." },
          {
            type: "file_ref",
            fileId: "file_1",
            name: "itinerary.pdf",
            mimeType: "application/pdf",
            size: 48213,
          },
        ],
        model: null,
        runId: null,
        createdAt: at,
      },
      {
        id: "msg_2",
        conversationId: "conv_1",
        parentId: "msg_1",
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            toolCallId: "call_1",
            name: "web_search",
            arguments: '{"query":"Kyoto temples"}',
          },
          {
            type: "tool_result",
            toolCallId: "call_1",
            name: "web_search",
            content: "5 results",
            isError: false,
          },
          { type: "text", text: "Here is a plan." },
          { type: "image_ref", fileId: "file_2", mimeType: "image/png", width: 1024, height: 1024 },
          { type: "citation", url: "https://example.com/kyoto", title: "Kyoto temples guide" },
        ],
        model: "gpt-5",
        runId: "run_1",
        createdAt: at,
      },
    ],
  }),
  "conversation-search": fixture(CloudConversationSearchResponse, {
    results: [{ conversation, messageId: "msg_1", snippet: "three days in Kyoto" }],
    nextCursor: null,
  }),
  "send-message": fixture(CloudSendMessageResponse, {
    message: {
      id: "msg_1",
      conversationId: "conv_1",
      parentId: null,
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
      model: null,
      runId: null,
      createdAt: at,
    },
    reply: {
      id: "msg_2",
      conversationId: "conv_1",
      parentId: "msg_1",
      role: "assistant",
      parts: [],
      model: "text.high",
      runId: "run_1",
      createdAt: at,
    },
    run: { ...run, status: "queued", lastSeq: 0 },
  }),
  "run-events": fixture(CloudRunEventsResponse, {
    run,
    events: [
      {
        runId: "run_1",
        seq: 1,
        type: "status",
        payload: { status: "running", error: null },
        createdAt: at,
      },
      {
        runId: "run_1",
        seq: 2,
        type: "step.started",
        payload: { step: 1, maxSteps: 25 },
        createdAt: at,
      },
      {
        runId: "run_1",
        seq: 3,
        type: "message.part",
        payload: {
          messageId: "msg_2",
          part: {
            type: "image_ref",
            fileId: "file_2",
            mimeType: "image/png",
            width: null,
            height: null,
          },
        },
        createdAt: at,
      },
      {
        runId: "run_1",
        seq: 4,
        type: "text.delta",
        payload: { messageId: "msg_2", text: "Here is" },
        createdAt: at,
      },
      {
        runId: "run_1",
        seq: 5,
        type: "usage",
        payload: {
          requestId: "req_1",
          model: "gpt-5",
          routeReason: "capability:text.high",
          inputTokens: 1200,
          outputTokens: 340,
          settled: "2758",
          remaining: "1999997242",
          cutOff: false,
        },
        createdAt: at,
      },
    ],
  }),
  "file-presign": fixture(CloudFilePresignResponse, {
    file: {
      id: "file_1",
      name: "itinerary.pdf",
      mimeType: "application/pdf",
      size: 48213,
      status: "pending",
      createdAt: at,
    },
    upload: {
      url: "https://storage.example.com/upload/file_1?signature=abc",
      method: "PUT",
      headers: { "content-type": "application/pdf", "content-length": "48213" },
      expiresAt: at,
    },
  }),
  file: fixture(CloudFile, {
    id: "file_1",
    name: "itinerary.pdf",
    mimeType: "application/pdf",
    size: 48213,
    status: "ready",
    createdAt: at,
  }),
  "file-url": fixture(CloudFileDownloadResponse, {
    url: "https://storage.example.com/file_1?signature=abc",
    expiresAt: at,
  }),
  "share-create": fixture(CloudCreateShareResponse, {
    share,
    url: "https://app.slcor.com/share/token_example",
  }),
  "share-revoke": fixture(CloudRevokeShareResponse, { share: { ...share, revokedAt: later } }),
  "share-public": fixture(CloudPublicShareResponse, {
    title: "Trip plan",
    createdAt: at,
    messages: [
      { role: "user", parts: [{ type: "text", text: "Hello" }], createdAt: at },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "Hi!" },
          { type: "image_ref", fileId: "file_2", mimeType: "image/png", width: 512, height: 512 },
        ],
        createdAt: at,
      },
    ],
    imageUrls: { file_2: "https://storage.example.com/file_2?signature=abc" },
  }),
  "native-token": fixture(CloudNativeTokenResponse, {
    sessionToken: "session_token_example",
    expiresAt: "2026-10-26T12:00:00.000Z",
    userId: "user_1",
    orgId: "org_1",
  }),
} as const;

/** Each fixture decoded and re-encoded through its schema, keyed by file name. */
export function encodeCloudFixtures(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(cloudFixtures).map(([name, { schema, encoded }]) => [
      name,
      Schema.encodeUnknownSync(schema)(Schema.decodeUnknownSync(schema)(encoded)),
    ]),
  );
}

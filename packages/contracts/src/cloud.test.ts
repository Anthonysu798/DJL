import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CloudCheckoutInput,
  CloudCreditsResponse,
  CloudMeResponse,
  CloudMessagePart,
  CloudNativeAuthorizeRequest,
  CloudNativeTokenInput,
  CloudRunEvent,
  CloudSendMessageInput,
  CloudFilePresignInput,
  CLOUD_FILE_MAX_BYTES,
  Microcredits,
} from "./cloud";

describe("cloud contract", () => {
  it("accepts microcredits as decimal strings only", () => {
    expect(Schema.decodeUnknownSync(Microcredits)("2500000000")).toBe("2500000000");
    expect(Schema.decodeUnknownSync(Microcredits)("-120")).toBe("-120");
    expect(() => Schema.decodeUnknownSync(Microcredits)("12.5")).toThrow();
    expect(() => Schema.decodeUnknownSync(Microcredits)(25)).toThrow();
  });

  it("decodes the /v1/me and /v1/credits shapes the backend emits", () => {
    const me = Schema.decodeUnknownSync(CloudMeResponse)({
      user: { id: "u1", email: "a@b.c", emailVerified: true },
      activeOrgId: "o1",
      role: "owner",
      organizations: [{ id: "o1", name: "Me", slug: "u-abc", role: "owner", personal: true }],
    });
    expect(me.organizations[0]?.personal).toBe(true);
    const credits = Schema.decodeUnknownSync(CloudCreditsResponse)({
      orgId: "o1",
      balances: { trial: "0", plan: "2000000000", topup: "0" },
      total: "2000000000",
      display: { total: "2000.00", trial: "0.00", plan: "2000.00", topup: "0.00" },
    });
    expect(credits.display.total).toBe("2000.00");
  });

  it("bounds top-ups to whole dollars between 5 and 10,000", () => {
    expect(Schema.decodeUnknownSync(CloudCheckoutInput)({ kind: "topup", usd: 25 })).toEqual({
      kind: "topup",
      usd: 25,
    });
    expect(() => Schema.decodeUnknownSync(CloudCheckoutInput)({ kind: "topup", usd: 4 })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CloudCheckoutInput)({ kind: "topup", usd: 5.5 }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(CloudCheckoutInput)({
        kind: "subscription",
        planId: "business",
        interval: "year",
      }).kind,
    ).toBe("subscription");
  });

  it("keeps tool parts out of what a user may send", () => {
    const base = { clientMessageId: "c1", parentId: null, model: "text.fast", mode: "chat" };
    expect(
      Schema.decodeUnknownSync(CloudSendMessageInput)({
        ...base,
        parts: [{ type: "text", text: "hi" }],
      }).parts,
    ).toHaveLength(1);
    expect(() =>
      Schema.decodeUnknownSync(CloudSendMessageInput)({
        ...base,
        parts: [{ type: "tool_call", toolCallId: "t", name: "python", arguments: "{}" }],
      }),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(CloudSendMessageInput)({ ...base, parts: [] })).toThrow();
    expect(
      Schema.decodeUnknownSync(CloudMessagePart)({
        type: "tool_result",
        toolCallId: "t",
        name: "python",
        content: "4",
        isError: false,
      }).type,
    ).toBe("tool_result");
  });

  it("decodes run events by type and rejects a zero seq", () => {
    const event = {
      runId: "r1",
      seq: 1,
      type: "text.delta",
      payload: { messageId: "m1", text: "Hel" },
      createdAt: "2026-09-26T00:00:00.000Z",
    };
    expect(Schema.decodeUnknownSync(CloudRunEvent)(event).type).toBe("text.delta");
    expect(() => Schema.decodeUnknownSync(CloudRunEvent)({ ...event, seq: 0 })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CloudRunEvent)({ ...event, type: "status", payload: event.payload }),
    ).toThrow();
  });

  it("requires PKCE S256 with a well-formed verifier and challenge", () => {
    const request = {
      redirectUri: "djl://auth/callback",
      state: "a".repeat(22),
      codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      codeChallengeMethod: "S256",
    };
    expect(Schema.decodeUnknownSync(CloudNativeAuthorizeRequest)(request).codeChallengeMethod).toBe(
      "S256",
    );
    expect(() =>
      Schema.decodeUnknownSync(CloudNativeAuthorizeRequest)({
        ...request,
        codeChallengeMethod: "plain",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CloudNativeTokenInput)({
        code: "c",
        codeVerifier: "too-short",
        redirectUri: "djl://auth/callback",
      }),
    ).toThrow();
  });

  it("bounds upload sizes", () => {
    const input = {
      name: "a.pdf",
      mimeType: "application/pdf",
      sha256: "0".repeat(64),
      purpose: "attachment",
    };
    expect(Schema.decodeUnknownSync(CloudFilePresignInput)({ ...input, size: 1 }).size).toBe(1);
    expect(() =>
      Schema.decodeUnknownSync(CloudFilePresignInput)({ ...input, size: CLOUD_FILE_MAX_BYTES + 1 }),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(CloudFilePresignInput)({ ...input, size: 0 })).toThrow();
  });
});

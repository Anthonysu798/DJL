import { expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@djl/shared/fcm", () => ({ createFcmSender: () => ({ send }) }));

import { createRelayFcmSender, normalizeInstallationId } from "./fcm";

it("preserves opaque installation identifiers without APNs normalization", () => {
  expect(normalizeInstallationId("AbC_Fid-123")).toBe("AbC_Fid-123");
  for (const invalid of [null, "", " AbC", "AbC\n", "AbC\u0000", "x".repeat(201)])
    expect(normalizeInstallationId(invalid)).toBeNull();
});

it("sends only canonical paired route data, omitting an absent turn", async () => {
  send.mockResolvedValue({ ok: true });
  const deliver = createRelayFcmSender({
    FCM_PROJECT_ID: "test-only",
    FCM_CLIENT_EMAIL: "test@test.invalid",
    FCM_PRIVATE_KEY: "test-only",
  });
  expect(
    await deliver({ deviceToken: "AbC_Fid", threadId: "thread-1", result: "completed" }),
  ).toEqual({ ok: true });
  expect(send).toHaveBeenLastCalledWith({
    installationId: "AbC_Fid",
    data: { source: "codex.runCompletion", threadId: "thread-1", result: "completed" },
  });
  await deliver({
    deviceToken: "AbC_Fid",
    threadId: "thread-1",
    turnId: "turn-1",
    result: "failed",
  });
  expect(send).toHaveBeenLastCalledWith({
    installationId: "AbC_Fid",
    data: {
      source: "codex.runCompletion",
      threadId: "thread-1",
      turnId: "turn-1",
      result: "failed",
    },
  });
});

it("fails closed without Firebase sender configuration", async () => {
  send.mockClear();
  expect(
    await createRelayFcmSender({})({
      deviceToken: "AbC_Fid",
      threadId: "thread-1",
      result: "completed",
    }),
  ).toEqual({ ok: false, reason: "fcm_not_configured" });
  expect(send).not.toHaveBeenCalled();
});

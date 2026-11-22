import { expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@djl/shared/fcm", () => ({ createFcmSender: () => ({ send }) }));

import { createFcmPushSender } from "./fcm.ts";

it("adapts only content-free data and preserves the FID", async () => {
  send.mockResolvedValue({ ok: true });
  const sender = createFcmPushSender({
    projectId: "test",
    clientEmail: "test@test.invalid",
    privateKey: "test-only",
  });
  const message = {
    title: "ignored title",
    body: "ignored body",
    data: { source: "djl.cloudRun", runId: "run-1" },
  };
  expect(await sender.send({ token: "AbC_Fid", environment: "production", message })).toEqual({
    ok: true,
  });
  expect(send).toHaveBeenLastCalledWith({ installationId: "AbC_Fid", data: message.data });
  send.mockResolvedValue({ ok: false, reason: "fcm_unregistered", unregistered: true });
  expect(await sender.send({ token: "AbC_Fid", environment: "production", message })).toEqual({
    ok: false,
    reason: "fcm_unregistered",
    unregistered: true,
  });
  send.mockClear();
  expect(await sender.send({ token: "AbC_Fid", environment: "sandbox", message })).toEqual({
    ok: false,
    reason: "fcm_invalid_environment",
    unregistered: false,
  });
  expect(send).not.toHaveBeenCalled();
});

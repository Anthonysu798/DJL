import { createFcmSender } from "@synara/shared/fcm";

import type { GenericPushInput } from "./apns";

export interface FcmConfiguration {
  readonly FCM_PROJECT_ID?: string;
  readonly FCM_CLIENT_EMAIL?: string;
  readonly FCM_PRIVATE_KEY?: string;
}

export const normalizeInstallationId = (value: unknown): string | null =>
  typeof value === "string" && /^[^\s\x00-\x1f\x7f]{1,200}$/.test(value) ? value : null;

export const fcmConfigured = (config: FcmConfiguration): boolean =>
  Boolean(config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY);

export function createRelayFcmSender(config: FcmConfiguration) {
  const sender = fcmConfigured(config)
    ? createFcmSender({
        projectId: config.FCM_PROJECT_ID!,
        clientEmail: config.FCM_CLIENT_EMAIL!,
        privateKey: config.FCM_PRIVATE_KEY!.replaceAll("\\n", "\n"),
      })
    : null;
  return async (input: GenericPushInput & { deviceToken: string }) => {
    if (!sender) return { ok: false as const, reason: "fcm_not_configured" };
    return sender.send({
      installationId: input.deviceToken,
      data: {
        source: "codex.runCompletion",
        threadId: input.threadId,
        result: input.result,
        ...(input.turnId ? { turnId: input.turnId } : {}),
      },
    });
  };
}

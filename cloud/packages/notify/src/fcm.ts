import { createFcmSender, type FcmConfig } from "@synara/shared/fcm";

import type { PushSender } from "./apns.ts";

export function createFcmPushSender(config: FcmConfig): PushSender {
  const sender = createFcmSender(config);
  return {
    async send({ token, environment, message }) {
      if (environment !== "production")
        return { ok: false, reason: "fcm_invalid_environment", unregistered: false };
      const result = await sender.send({ installationId: token, data: message.data });
      return result.ok ? result : { ...result, unregistered: result.unregistered ?? false };
    },
  };
}

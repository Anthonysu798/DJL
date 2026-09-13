import twilio from "twilio";

import type { Locale, PhoneLineType, SmsSender } from "./types.ts";

/**
 * Twilio Verify for OTP delivery (with Twilio's own fraud guard) and Lookup v2
 * for line type. Mainland China delivery is unreliable; the API falls back to
 * email OTP for +86 numbers until Aliyun SMS is wired in.
 */
export function createTwilioSender(input: {
  readonly accountSid: string;
  readonly authToken: string;
  readonly verifyServiceSid: string;
  readonly fromNumber: string;
}): SmsSender {
  const client = twilio(input.accountSid, input.authToken);
  return {
    async sendVerification({
      phoneNumber,
      code,
      locale,
    }: {
      phoneNumber: string;
      code: string;
      locale: Locale;
    }) {
      const verification = await client.verify.v2
        .services(input.verifyServiceSid)
        .verifications.create({
          to: phoneNumber,
          channel: "sms",
          customCode: code,
          locale: locale === "zh-Hans" ? "zh" : "en",
        });
      return { id: verification.sid };
    },
    async lookupLineType(phoneNumber: string): Promise<PhoneLineType> {
      const result = await client.lookups.v2
        .phoneNumbers(phoneNumber)
        .fetch({ fields: "line_type_intelligence" });
      const type = (result.lineTypeIntelligence as { type?: string } | null)?.type;
      if (type === "mobile") return "mobile";
      if (type === "landline" || type === "fixedVoip") return "landline";
      if (type === "nonFixedVoip" || type === "voip" || type === "personal" || type === "tollFree")
        return "voip";
      return "unknown";
    },
    async sendText({ phoneNumber, body }: { phoneNumber: string; body: string }) {
      await client.messages.create({ to: phoneNumber, from: input.fromNumber, body });
    },
  };
}

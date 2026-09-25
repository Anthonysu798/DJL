import { Resend } from "resend";

import type { EmailMessage, EmailSender } from "./types.ts";

export function createResendSender(input: {
  readonly apiKey: string;
  readonly from: string; // "DJL Cloud <no-reply@slcor.com>"
  readonly replyTo: string; // support@slcor.com
}): EmailSender {
  const client = new Resend(input.apiKey);
  return {
    async send(message: EmailMessage) {
      const result = await client.emails.send({
        from: input.from,
        to: message.to,
        replyTo: input.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: "category", value: message.tag }],
      });
      if (result.error) throw new Error(`resend: ${result.error.name}: ${result.error.message}`);
      return { id: result.data?.id ?? "" };
    },
  };
}

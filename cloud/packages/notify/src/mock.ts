import type {
  EmailMessage,
  EmailSender,
  PhoneLineType,
  SmsSender,
  TeamAlertSender,
} from "./types.ts";

/**
 * In-memory senders for local development and tests. Everything that would
 * have gone out is captured so tests can assert on it and developers can read
 * OTP codes from the log.
 */
export class MockOutbox implements EmailSender, SmsSender, TeamAlertSender {
  readonly emails: EmailMessage[] = [];
  readonly sms: { readonly phoneNumber: string; readonly code?: string; readonly body?: string }[] =
    [];
  readonly alerts: { readonly severity: string; readonly title: string; readonly body: string }[] =
    [];
  lineTypes = new Map<string, PhoneLineType>();
  private counter = 0;

  constructor(private readonly log: boolean = false) {}

  async send(message: EmailMessage) {
    this.emails.push(message);
    if (this.log)
      console.log(`[mock email] to=${message.to} subject=${message.subject}\n${message.text}`);
    return { id: `mock_email_${++this.counter}` };
  }

  async sendVerification(input: {
    readonly phoneNumber: string;
    readonly code: string;
    readonly locale?: string;
  }) {
    this.sms.push({ phoneNumber: input.phoneNumber, code: input.code });
    if (this.log) console.log(`[mock sms] to=${input.phoneNumber} code=${input.code}`);
    return { id: `mock_sms_${++this.counter}` };
  }

  async lookupLineType(phoneNumber: string): Promise<PhoneLineType> {
    return this.lineTypes.get(phoneNumber) ?? "mobile";
  }

  async sendText(input: { readonly phoneNumber: string; readonly body: string }) {
    this.sms.push(input);
  }

  async post(input: {
    readonly severity: "info" | "warn" | "p0";
    readonly title: string;
    readonly body: string;
  }) {
    this.alerts.push(input);
    if (this.log) console.log(`[mock alert] ${input.severity} ${input.title}`);
  }

  clear() {
    this.emails.length = 0;
    this.sms.length = 0;
    this.alerts.length = 0;
  }
}

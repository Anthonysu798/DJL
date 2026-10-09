export type Locale = "en" | "zh-Hans";

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly tag: string; // resend tag / analytics category
}

export interface EmailSender {
  readonly send: (message: EmailMessage) => Promise<{ readonly id: string }>;
}

export type PhoneLineType = "mobile" | "landline" | "voip" | "unknown";

export interface SmsSender {
  /** Start an OTP verification for a phone number. Returns the provider's verification id. */
  readonly sendVerification: (input: {
    readonly phoneNumber: string;
    readonly code: string;
    readonly locale: Locale;
  }) => Promise<{ readonly id: string }>;
  /** Carrier lookup: is this a real mobile line? Blocks VoIP for trial credits. */
  readonly lookupLineType: (phoneNumber: string) => Promise<PhoneLineType>;
  /** Plain transactional text (P0 alerts). */
  readonly sendText: (input: {
    readonly phoneNumber: string;
    readonly body: string;
  }) => Promise<void>;
}

export interface TeamAlertSender {
  readonly post: (input: {
    readonly severity: "info" | "warn" | "p0";
    readonly title: string;
    readonly body: string;
  }) => Promise<void>;
}

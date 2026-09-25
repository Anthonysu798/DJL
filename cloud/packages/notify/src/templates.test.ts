import { describe, expect, it } from "vitest";

import { MockOutbox } from "./mock.ts";
import { emailOtp, lowCredit, securityNotice } from "./templates.ts";

describe("templates", () => {
  it("renders English and Simplified Chinese OTP emails and escapes html", () => {
    const en = emailOtp("a@b.c", "123456", "en");
    expect(en.subject).toBe("123456 is your DJL Cloud code");
    const zh = emailOtp("a@b.c", "123456", "zh-Hans");
    expect(zh.subject).toContain("验证码");
    const notice = securityNotice("a@b.c", "<script>", "now", "https://x", "en");
    expect(notice.html).toContain("&lt;script&gt;");
  });
  it("captures sends in the mock outbox", async () => {
    const outbox = new MockOutbox();
    await outbox.send(lowCredit("a@b.c", "Acme", 20, "400.00", "https://x", "en"));
    await outbox.sendVerification({ phoneNumber: "+15550001111", code: "000111", locale: "en" });
    expect(outbox.emails[0]?.tag).toBe("low-credit");
    expect(outbox.sms[0]?.code).toBe("000111");
  });
});

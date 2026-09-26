import { describe, expect, it } from "vitest";

import { MockOutbox } from "./mock.ts";
import { emailOtp, lowCredit, securityNotice, taskFinished } from "./templates.ts";

describe("templates", () => {
  it("renders English and Simplified Chinese OTP emails and escapes html", () => {
    const en = emailOtp("a@b.c", "123456", "en");
    expect(en.subject).toBe("123456 is your DJL Cloud code");
    const zh = emailOtp("a@b.c", "123456", "zh-Hans");
    expect(zh.subject).toContain("验证码");
    const notice = securityNotice("a@b.c", "<script>", "now", "https://x", "en");
    expect(notice.html).toContain("&lt;script&gt;");
  });
  it("renders task-finished emails in both languages", () => {
    const en = taskFinished("a@b.c", true, "Trip plan", "https://app/chat/1", "en");
    expect(en.subject).toBe("Your DJL task is done");
    expect(en.text).toContain('"Trip plan"');
    expect(en.text).toContain("https://app/chat/1");
    const zh = taskFinished("a@b.c", false, null, "https://app/chat/1", "zh-Hans");
    expect(zh.subject).toBe("你的 DJL 任务未能完成");
    expect(zh.text).toContain("未命名任务");
  });
  it("captures sends in the mock outbox", async () => {
    const outbox = new MockOutbox();
    await outbox.send(lowCredit("a@b.c", "Acme", 20, "400.00", "https://x", "en"));
    await outbox.sendVerification({ phoneNumber: "+15550001111", code: "000111", locale: "en" });
    expect(outbox.emails[0]?.tag).toBe("low-credit");
    expect(outbox.sms[0]?.code).toBe("000111");
  });
});

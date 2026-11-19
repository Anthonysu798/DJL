import { it, expect } from "vitest";
import { webhookMessage } from "./webhook";
it("preserves upstream WeCom and DingTalk text message shapes", () => {
  expect(
    webhookMessage(
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture",
      "Title",
      "Caption",
    ),
  ).toEqual({ msgtype: "text", text: { content: "Title\nCaption" } });
  expect(webhookMessage("https://oapi.dingtalk.com/robot/send", "", "Caption")).toEqual({
    msgtype: "text",
    text: { content: "Caption" },
  });
});
it("preserves the upstream default webhook payload without inventing media", () => {
  expect(webhookMessage("http://127.0.0.1:5745/hook", "Title", "Caption")).toEqual({
    msg_type: "text",
    content: { text: "Title\nCaption" },
  });
});

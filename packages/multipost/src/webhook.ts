/** DJL transport adaptation of vendor/sync/dynamic/webhook.ts (Apache-2.0). */
export function webhookMessage(
  url: string,
  title: string,
  content: string,
): Record<string, unknown> {
  const text = title ? `${title}\n${content}` : content;
  const host = new URL(url).hostname;
  return ["qyapi.weixin.qq.com", "oapi.dingtalk.com"].includes(host)
    ? { msgtype: "text", text: { content: text } }
    : { msg_type: "text", content: { text } };
}

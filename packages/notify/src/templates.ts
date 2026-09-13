import type { EmailMessage, Locale } from "./types.ts";

/**
 * Transactional email templates, English and Simplified Chinese first
 * (decision: Languages). Plain HTML with inline styles so every client renders it.
 */
const strings = {
  en: {
    otpSubject: (code: string) => `${code} is your DJL Cloud code`,
    otpBody: (code: string) =>
      `Your verification code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
    resetSubject: "Reset your DJL Cloud password",
    resetBody: (url: string) =>
      `Click the link to choose a new password. It expires in 1 hour.\n${url}`,
    inviteSubject: (org: string) => `You are invited to ${org} on DJL Cloud`,
    inviteBody: (org: string, inviter: string, url: string) =>
      `${inviter} invited you to join ${org}. Accept here (expires in 7 days):\n${url}`,
    lowCreditSubject: (pct: number) =>
      pct === 0 ? "Your DJL Cloud credits are used up" : `DJL Cloud credits below ${pct}%`,
    lowCreditBody: (org: string, remaining: string, url: string) =>
      `${org} has ${remaining} credits left. Add credits or upgrade:\n${url}`,
    securitySubject: (event: string) => `DJL Cloud security notice: ${event}`,
    securityBody: (event: string, when: string, url: string) =>
      `${event} on ${when}. If this was not you, secure your account now:\n${url}`,
  },
  "zh-Hans": {
    otpSubject: (code: string) => `${code} 是你的 DJL Cloud 验证码`,
    otpBody: (code: string) =>
      `你的验证码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略此邮件。`,
    resetSubject: "重置你的 DJL Cloud 密码",
    resetBody: (url: string) => `点击链接设置新密码，链接 1 小时内有效。\n${url}`,
    inviteSubject: (org: string) => `你被邀请加入 DJL Cloud 上的 ${org}`,
    inviteBody: (org: string, inviter: string, url: string) =>
      `${inviter} 邀请你加入 ${org}。在此接受（7 天内有效）：\n${url}`,
    lowCreditSubject: (pct: number) =>
      pct === 0 ? "你的 DJL Cloud 积分已用完" : `DJL Cloud 积分低于 ${pct}%`,
    lowCreditBody: (org: string, remaining: string, url: string) =>
      `${org} 还剩 ${remaining} 积分。充值或升级：\n${url}`,
    securitySubject: (event: string) => `DJL Cloud 安全提醒：${event}`,
    securityBody: (event: string, when: string, url: string) =>
      `${when} 发生了 ${event}。如果不是你本人操作，请立即保护账户：\n${url}`,
  },
} as const;

function wrap(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${escaped}<br/><br/><span style="color:#777">DJL Cloud</span></div>`;
}

export function emailOtp(to: string, code: string, locale: Locale): EmailMessage {
  const s = strings[locale];
  const text = s.otpBody(code);
  return { to, subject: s.otpSubject(code), text, html: wrap(text), tag: "otp" };
}

export function passwordReset(to: string, url: string, locale: Locale): EmailMessage {
  const s = strings[locale];
  const text = s.resetBody(url);
  return { to, subject: s.resetSubject, text, html: wrap(text), tag: "password-reset" };
}

export function organizationInvite(
  to: string,
  org: string,
  inviter: string,
  url: string,
  locale: Locale,
): EmailMessage {
  const s = strings[locale];
  const text = s.inviteBody(org, inviter, url);
  return { to, subject: s.inviteSubject(org), text, html: wrap(text), tag: "invite" };
}

export function lowCredit(
  to: string,
  org: string,
  pct: number,
  remaining: string,
  url: string,
  locale: Locale,
): EmailMessage {
  const s = strings[locale];
  const text = s.lowCreditBody(org, remaining, url);
  return { to, subject: s.lowCreditSubject(pct), text, html: wrap(text), tag: "low-credit" };
}

export function securityNotice(
  to: string,
  event: string,
  when: string,
  url: string,
  locale: Locale,
): EmailMessage {
  const s = strings[locale];
  const text = s.securityBody(event, when, url);
  return { to, subject: s.securitySubject(event), text, html: wrap(text), tag: "security" };
}

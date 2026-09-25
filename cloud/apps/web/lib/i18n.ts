/**
 * English and Simplified Chinese first (decision: Languages). The locale comes
 * from the `djl_locale` cookie, then the browser language.
 */
export type Locale = "en" | "zh-Hans";

const dict = {
  en: {
    appName: "DJL Cloud",
    signIn: "Sign in",
    signUp: "Create account",
    email: "Email",
    password: "Password",
    name: "Name",
    continue: "Continue",
    orContinueWith: "or continue with",
    google: "Google",
    apple: "Apple",
    noAccount: "No account yet?",
    haveAccount: "Already have an account?",
    forgot: "Forgot password?",
    verifyTitle: "Check your email",
    verifyBody: "Enter the 6-digit code we sent to {email}.",
    code: "Code",
    verify: "Verify",
    resend: "Send a new code",
    deviceTitle: "Connect a device",
    deviceBody:
      "Approve DJL on the device that shows this code. Only approve codes you started yourself.",
    deviceCode: "Device code",
    approve: "Approve",
    deny: "Deny",
    deviceApproved: "Approved. You can return to the app.",
    deviceDenied: "Denied. Nothing was connected.",
    account: "Account",
    credits: "Credits",
    creditsAvailable: "{credits} credits available",
    trial: "Trial",
    plan: "Plan",
    topup: "Top-ups",
    billing: "Billing",
    buyCredits: "Buy credits",
    manageBilling: "Manage billing",
    subscribe: "Subscribe",
    perMonth: "/month",
    topupAmount: "Top-up amount (USD)",
    topupHint: "100 credits per dollar. Minimum $5.",
    signOut: "Sign out",
    devices: "Devices",
    noDevices: "No devices yet. Sign in from the desktop app to see it here.",
    error: "Something went wrong.",
    loading: "Loading…",
    agree:
      "By continuing you confirm you are 18 or older and agree to the Terms and Privacy Policy.",
    tiers: { starter: "Starter", business: "Business", autopilot: "Autopilot" },
    tierCredits: "{credits} credits every month",
    currentPlan: "Current plan",
  },
  "zh-Hans": {
    appName: "DJL Cloud",
    signIn: "登录",
    signUp: "创建账户",
    email: "邮箱",
    password: "密码",
    name: "姓名",
    continue: "继续",
    orContinueWith: "或使用以下方式",
    google: "Google",
    apple: "Apple",
    noAccount: "还没有账户？",
    haveAccount: "已有账户？",
    forgot: "忘记密码？",
    verifyTitle: "请查收邮件",
    verifyBody: "输入我们发送到 {email} 的 6 位验证码。",
    code: "验证码",
    verify: "验证",
    resend: "重新发送验证码",
    deviceTitle: "连接设备",
    deviceBody: "在显示此代码的设备上批准 DJL。只批准你自己发起的代码。",
    deviceCode: "设备代码",
    approve: "批准",
    deny: "拒绝",
    deviceApproved: "已批准，你可以返回应用。",
    deviceDenied: "已拒绝，没有连接任何设备。",
    account: "账户",
    credits: "积分",
    creditsAvailable: "可用积分 {credits}",
    trial: "试用",
    plan: "套餐",
    topup: "充值",
    billing: "账单",
    buyCredits: "购买积分",
    manageBilling: "管理账单",
    subscribe: "订阅",
    perMonth: "/月",
    topupAmount: "充值金额（美元）",
    topupHint: "每美元 100 积分，最低 5 美元。",
    signOut: "退出登录",
    devices: "设备",
    noDevices: "还没有设备。在桌面应用中登录后会显示在这里。",
    error: "出了点问题。",
    loading: "加载中…",
    agree: "继续即表示你已年满 18 岁并同意服务条款和隐私政策。",
    tiers: { starter: "Starter", business: "Business", autopilot: "Autopilot" },
    tierCredits: "每月 {credits} 积分",
    currentPlan: "当前套餐",
  },
} as const;

export type Dict = (typeof dict)["en"];

export function detectLocale(acceptLanguage: string | null, cookie: string | null): Locale {
  if (cookie === "zh-Hans" || cookie === "en") return cookie;
  const lang = (acceptLanguage ?? "").toLowerCase();
  return lang.startsWith("zh") ? "zh-Hans" : "en";
}

export function t(locale: Locale): Dict {
  return dict[locale] as Dict;
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? "");
}

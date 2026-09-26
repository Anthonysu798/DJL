/**
 * HTTP test client for a running API: a cookie jar, the web app's CSRF
 * double-submit header on cookie mutations, and its own client IP so Better
 * Auth throttles (shared in Redis) never mix between test files.
 */
import type { ApiRuntime } from "../server.ts";

export const WEB_ORIGIN = "http://localhost:3000";

export interface CallInit extends RequestInit {
  readonly json?: unknown;
  /** `Authorization: Bearer` value; cookies are not sent when set. */
  readonly bearer?: string;
  /** Skip the automatic CSRF header (to test refusals). */
  readonly csrf?: false;
}

export function randomIp(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

export class TestClient {
  readonly jar = new Map<string, string>();
  private csrfToken: string | null = null;

  constructor(
    readonly base: string,
    readonly ip: string = randomIp(),
  ) {}

  static for(api: ApiRuntime, ip?: string): TestClient {
    return new TestClient(`http://127.0.0.1:${api.address.port}`, ip);
  }

  cookieHeader(): string {
    return Array.from(this.jar.entries(), ([k, v]) => `${k}=${v}`).join("; ");
  }

  async call(path: string, init: CallInit = {}): Promise<Response> {
    const { json, bearer, csrf, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (!headers.has("origin")) headers.set("origin", WEB_ORIGIN);
    headers.set("fly-client-ip", this.ip);
    if (bearer) headers.set("authorization", `Bearer ${bearer}`);
    else if (this.jar.size > 0) headers.set("cookie", this.cookieHeader());
    const mutating = rest.method !== undefined && rest.method !== "GET";
    if (mutating && !bearer && csrf !== false && !path.startsWith("/v1/auth/")) {
      this.csrfToken ??= ((await (await this.call("/v1/csrf")).json()) as { token: string }).token;
      headers.set("x-csrf-token", this.csrfToken);
      headers.set("cookie", this.cookieHeader());
    }
    let body: BodyInit | null = rest.body ?? null;
    if (json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(json);
    }
    const res = await fetch(`${this.base}${path}`, { ...rest, headers, body });
    if (!bearer) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const [name, ...value] = pair!.split("=");
        if (name) this.jar.set(name.trim(), value.join("="));
      }
    }
    return res;
  }

  /** Sign up with email + password and verify with the OTP from the mock outbox. */
  async signUp(api: ApiRuntime, label = "user") {
    const email = `${label}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const password = "correct-horse-battery-staple";
    const signup = await this.call("/v1/auth/sign-up/email", {
      method: "POST",
      json: { email, password, name: label },
    });
    if (signup.status !== 200) throw new Error(`sign-up failed: ${signup.status}`);
    const mail = api.outbox!.emails.findLast((m) => m.to === email && m.tag === "otp");
    const otp = mail!.subject.match(/^(\d{6})/)![1];
    const verify = await this.call("/v1/auth/email-otp/verify-email", {
      method: "POST",
      json: { email, otp },
    });
    if (verify.status !== 200) throw new Error(`verify failed: ${verify.status}`);
    const me = (await (await this.call("/v1/me")).json()) as {
      user: { id: string };
      activeOrgId: string;
    };
    return { email, password, userId: me.user.id, orgId: me.activeOrgId };
  }
}

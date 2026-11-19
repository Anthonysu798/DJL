"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CommerceDesktopBridge } from "@synara/contracts/cloud";

import {
  AuthFrame,
  AuthField,
  PasswordInput,
  ProviderIcon,
  validateAuthForm,
  type AuthFieldErrors,
} from "@/components/AuthFrame";

import { authClient } from "@/lib/auth-client";
import { APPLE_SIGN_IN_ENABLED, GOOGLE_SIGN_IN_ENABLED } from "@/lib/config";
import { useLocale } from "@/lib/locale-context";
import { safeNext } from "@/lib/safeNext";
import { signInMethodFromNext } from "@/lib/signInMethod";

type Factor = "totp" | "otp" | "backup";
type Challenge = { methods: readonly Factor[]; email: string; next: string };

function confirmsEmailSignIn(
  data: { token?: unknown; user?: { email?: unknown } | null } | null | undefined,
  email: string,
): boolean {
  return (
    typeof data?.token === "string" &&
    data.token.length > 0 &&
    typeof data.user?.email === "string" &&
    data.user.email.toLowerCase() === email.trim().toLowerCase()
  );
}

function SignInForm() {
  const { d } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const requestedNext = safeNext(params.get("next"), "");
  const next = requestedNext || "/chat";
  const recoveryQuery = requestedNext ? `?${new URLSearchParams({ next: requestedNext })}` : "";
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [embedded, setEmbedded] = useState<boolean | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [factor, setFactor] = useState<Factor>("totp");
  const [code, setCode] = useState("");
  const [emailCodeRequested, setEmailCodeRequested] = useState(false);
  const challengeHeading = useRef<HTMLHeadingElement>(null);
  const request = useRef<symbol | null>(null);
  const startedGoogle = useRef(false);
  const twoFactor = d.auth.twoFactor;
  useEffect(
    () =>
      setEmbedded(
        (window as Window & { djlCommerce?: CommerceDesktopBridge }).djlCommerce?.kind ===
          "desktop",
      ),
    [],
  );

  useEffect(
    () => () => {
      request.current = null;
    },
    [],
  );
  useEffect(() => {
    if (challenge) challengeHeading.current?.focus();
  }, [challenge]);

  const run = useCallback(
    async (action: (current: () => boolean) => Promise<void>) => {
      if (request.current) return;
      const owner = Symbol();
      request.current = owner;
      const current = () => request.current === owner;
      setBusy(true);
      setError(null);
      try {
        await action(current);
      } catch {
        if (current()) setError(d.error);
      } finally {
        if (current()) {
          request.current = null;
          setBusy(false);
        }
      }
    },
    [d.error],
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (request.current || challenge) return;
    const found = validateAuthForm(event.currentTarget, d);
    setFieldErrors(found);
    setError(null);
    if (Object.keys(found).length) {
      event.currentTarget.querySelector<HTMLInputElement>(`#${Object.keys(found)[0]}`)?.focus();
      return;
    }
    await run(async (current) => {
      const result = await authClient.signIn.email({ email, password, rememberMe });
      if (!current()) return;
      if (result?.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
          if (current())
            router.push(
              `/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,
            );
          return;
        }
        setError(result.error.message ?? d.error);
        return;
      }
      const data = result?.data;
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect === true) {
        const advertised =
          "twoFactorMethods" in data && Array.isArray(data.twoFactorMethods)
            ? data.twoFactorMethods
            : [];
        const methods: Factor[] = [];
        if (advertised.includes("totp")) methods.push("totp");
        if (advertised.includes("otp")) methods.push("otp");
        // Stock Better Auth generates backup codes at TOTP setup, not email-only setup.
        if (methods.includes("totp")) methods.push("backup");
        setPassword("");
        setFactor(methods[0] ?? "totp");
        setChallenge({ methods, email, next });
        return;
      }
      if (!confirmsEmailSignIn(data, email)) {
        setError(d.error);
        return;
      }
      router.push(next);
    });
  };

  const social = useCallback(
    async (provider: "google" | "apple") => {
      if (
        challenge ||
        (window as Window & { djlCommerce?: CommerceDesktopBridge }).djlCommerce?.kind === "desktop"
      )
        return;
      await run(async (current) => {
        const result = await authClient.signIn.social({
          provider,
          callbackURL: `${window.location.origin}${next}`,
        });
        if (current() && result?.error) setError(result.error.message ?? d.error);
      });
    },
    [challenge, next, d.error, run],
  );

  useEffect(() => {
    if (
      embedded !== false ||
      !GOOGLE_SIGN_IN_ENABLED ||
      startedGoogle.current ||
      signInMethodFromNext(next) !== "google"
    )
      return;
    startedGoogle.current = true;
    void social("google");
  }, [embedded, next, social]);

  if (challenge) {
    const verifyFactor = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (request.current || !challenge.methods.includes(factor)) return;
      if (factor === "otp" && !emailCodeRequested) return;
      const value = code.trim();
      const isBackup = factor === "backup";
      if (!(isBackup ? /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/ : /^\d{6}$/).test(value)) {
        setError(isBackup ? twoFactor.invalidBackupCode : twoFactor.invalidCode);
        return;
      }
      setCode("");
      await run(async (current) => {
        const input = { code: value };
        const result =
          factor === "totp"
            ? await authClient.twoFactor.verifyTotp(input)
            : factor === "otp"
              ? await authClient.twoFactor.verifyOtp(input)
              : await authClient.twoFactor.verifyBackupCode(input);
        if (!current()) return;
        if (result?.error || !confirmsEmailSignIn(result?.data, challenge.email)) {
          setError(twoFactor.verifyFailed);
          return;
        }
        router.push(challenge.next);
      });
    };

    const requestEmailCode = async () => {
      if (request.current || factor !== "otp" || !challenge.methods.includes("otp")) return;
      setCode("");
      setEmailCodeRequested(false);
      await run(async (current) => {
        const result = await authClient.twoFactor.sendOtp({});
        if (!current()) return;
        if (result?.error || result?.data?.status !== true) {
          setError(twoFactor.sendFailed);
          return;
        }
        setEmailCodeRequested(true);
      });
    };

    const restart = () => {
      if (request.current) return;
      setChallenge(null);
      setPassword("");
      setCode("");
      setEmailCodeRequested(false);
      setError(null);
    };

    return (
      <AuthFrame
        footer={
          <button
            type="button"
            className="font-medium text-neutral-900 underline underline-offset-4"
            disabled={busy}
            onClick={restart}
          >
            {twoFactor.restart}
          </button>
        }
      >
        <h1
          ref={challengeHeading}
          tabIndex={-1}
          className="text-[30px] leading-tight font-medium tracking-tight"
        >
          {twoFactor.title}
        </h1>
        <p className="mt-3 mb-8 text-[15px] leading-6 text-neutral-500">{twoFactor.body}</p>
        {challenge.methods.length ? (
          <form noValidate onSubmit={verifyFactor} className="space-y-4">
            <fieldset disabled={busy} className="space-y-2 text-sm">
              <legend className="label">{twoFactor.methods}</legend>
              {challenge.methods.map((method) => (
                <label key={method} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="two-factor-method"
                    checked={factor === method}
                    onChange={() => {
                      if (request.current) return;
                      setFactor(method);
                      setCode("");
                      setError(null);
                    }}
                  />
                  {twoFactor[method]}
                </label>
              ))}
            </fieldset>
            {factor === "otp" ? (
              <>
                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={busy}
                  onClick={() => void requestEmailCode()}
                >
                  {emailCodeRequested ? twoFactor.resend : twoFactor.send}
                </button>
                {emailCodeRequested ? (
                  <p role="status" className="text-sm text-neutral-600">
                    {twoFactor.sent}
                  </p>
                ) : null}
              </>
            ) : null}
            <AuthField
              id="two-factor-code"
              label={factor === "backup" ? twoFactor.backupCode : twoFactor.code}
              error={error ?? undefined}
            >
              <input
                id="two-factor-code"
                className="input"
                autoComplete={factor === "backup" ? "off" : "one-time-code"}
                inputMode={factor === "backup" ? "text" : "numeric"}
                autoCapitalize="none"
                spellCheck={false}
                maxLength={factor === "backup" ? 11 : 6}
                disabled={busy || (factor === "otp" && !emailCodeRequested)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "two-factor-code-error" : undefined}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setError(null);
                }}
              />
            </AuthField>
            <button
              type="submit"
              className="btn w-full"
              disabled={busy || (factor === "otp" && !emailCodeRequested)}
            >
              {busy ? d.loading : twoFactor.verify}
            </button>
          </form>
        ) : (
          <p role="alert" className="text-sm text-red-700">
            {twoFactor.unavailable}
          </p>
        )}
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      footer={
        <>
          {d.noAccount}{" "}
          <Link
            className="font-medium text-neutral-900 underline underline-offset-4"
            href={`/sign-up?next=${encodeURIComponent(next)}`}
          >
            {d.signUp}
          </Link>
        </>
      }
    >
      <h1 className="text-[30px] leading-tight font-medium tracking-tight">{d.auth.signInTitle}</h1>
      <p className="mt-3 mb-8 text-[15px] leading-6 text-neutral-500">{d.auth.signInBody}</p>
      <div className="flex flex-col gap-3">
        {embedded === false && GOOGLE_SIGN_IN_ENABLED ? (
          <button
            className="btn-secondary w-full gap-2"
            type="button"
            disabled={busy}
            onClick={() => void social("google")}
          >
            <ProviderIcon provider="google" />
            {d.auth.continueGoogle}
          </button>
        ) : null}
        {embedded === false && APPLE_SIGN_IN_ENABLED ? (
          <button
            className="btn-secondary w-full gap-2"
            type="button"
            disabled={busy}
            onClick={() => void social("apple")}
          >
            <ProviderIcon provider="apple" />
            {d.auth.continueApple}
          </button>
        ) : null}
      </div>
      {embedded ? (
        <p className="my-4 text-sm text-neutral-600">
          当前独立商城窗口仅支持邮箱和密码登录，暂不支持 Google / Apple；不会打开外部授权页面。
        </p>
      ) : null}
      {embedded === false && (GOOGLE_SIGN_IN_ENABLED || APPLE_SIGN_IN_ENABLED) ? (
        <div className="my-6 flex items-center gap-4 text-xs text-neutral-500">
          <span className="h-px flex-1 bg-neutral-200" />
          {d.auth.or}
          <span className="h-px flex-1 bg-neutral-200" />
        </div>
      ) : null}
      <form noValidate onSubmit={submit} className="space-y-6">
        <AuthField id="email" label={d.email} error={fieldErrors.email}>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            placeholder=""
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((errors) => ({ ...errors, email: undefined }));
              setError(null);
            }}
          />
        </AuthField>
        <AuthField id="password" label={d.password} error={fieldErrors.password}>
          <PasswordInput
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            placeholder=""
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((errors) => ({ ...errors, password: undefined }));
              setError(null);
            }}
          />
        </AuthField>
        <div className="flex items-center justify-between gap-3 text-xs">
          <label className="flex items-center gap-2 text-[#101828]">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="size-3.5 accent-[#101828]"
            />
            {d.auth.remember}
          </label>
          <Link
            href={`/forgot-password${recoveryQuery}`}
            className="text-[#101828] underline underline-offset-2"
          >
            {d.auth.forgot}
          </Link>
        </div>
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button className="btn w-full" disabled={busy} type="submit">
          {busy ? d.loading : d.signIn}
        </button>
      </form>
    </AuthFrame>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

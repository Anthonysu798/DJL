"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthFrame, PasswordInput, ProviderIcon } from "@/components/AuthFrame";

import { authClient } from "@/lib/auth-client";
import { APPLE_SIGN_IN_ENABLED, GOOGLE_SIGN_IN_ENABLED } from "@/lib/config";
import { useLocale } from "@/lib/locale-context";
import { safeNext } from "@/lib/safeNext";

function SignInForm() {
  const { d } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      if (result.error.code === "EMAIL_NOT_VERIFIED") {
        await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
        router.push(`/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
        return;
      }
      setError(result.error.message ?? d.error);
      return;
    }
    router.push(next);
  };

  const social = (provider: "google" | "apple") =>
    authClient.signIn.social({ provider, callbackURL: `${window.location.origin}${next}` });

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
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="email">
            {d.email}
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            {d.password}
          </label>
          <PasswordInput
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            placeholder={d.auth.passwordPlaceholder}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
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
      {GOOGLE_SIGN_IN_ENABLED || APPLE_SIGN_IN_ENABLED ? (
        <div className="my-6 flex items-center gap-4 text-xs text-neutral-500">
          <span className="h-px flex-1 bg-neutral-200" />
          {d.orContinueWith}
          <span className="h-px flex-1 bg-neutral-200" />
        </div>
      ) : null}
      <div className="flex gap-3 [&>button]:flex-1">
        {GOOGLE_SIGN_IN_ENABLED ? (
          <button
            className="btn-secondary gap-2"
            type="button"
            onClick={() => void social("google")}
          >
            <ProviderIcon provider="google" />
            {d.google}
          </button>
        ) : null}
        {APPLE_SIGN_IN_ENABLED ? (
          <button
            className="btn-secondary gap-2"
            type="button"
            onClick={() => void social("apple")}
          >
            <ProviderIcon provider="apple" />
            {d.apple}
          </button>
        ) : null}
      </div>
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

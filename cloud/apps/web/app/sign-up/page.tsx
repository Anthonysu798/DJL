"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

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

function SignUpForm() {
  const { d } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateAuthForm(event.currentTarget, d);
    setFieldErrors(found);
    setError(null);
    if (Object.keys(found).length) {
      event.currentTarget.querySelector<HTMLInputElement>(`#${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.signUp.email({ name, email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? d.error);
      return;
    }
    router.push(`/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  };

  const social = (provider: "google" | "apple") =>
    authClient.signIn.social({ provider, callbackURL: `${window.location.origin}${next}` });

  return (
    <AuthFrame
      footer={
        <>
          {d.haveAccount}{" "}
          <Link
            className="font-medium text-neutral-900 underline underline-offset-4"
            href={`/sign-in?next=${encodeURIComponent(next)}`}
          >
            {d.signIn}
          </Link>
        </>
      }
    >
      <h1 className="text-[30px] leading-tight font-medium tracking-tight">{d.auth.signUpTitle}</h1>
      <p className="mt-3 mb-8 text-[15px] leading-6 text-neutral-500">{d.auth.signUpBody}</p>
      <form noValidate onSubmit={submit} className="space-y-5">
        <AuthField id="name" label={d.name} error={fieldErrors.name}>
          <input
            id="name"
            className="input"
            autoComplete="name"
            required
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors((errors) => ({ ...errors, name: undefined }));
              setError(null);
            }}
          />
        </AuthField>
        <AuthField id="email" label={d.email} error={fieldErrors.email}>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
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
            autoComplete="new-password"
            minLength={10}
            required
            placeholder={d.auth.passwordPlaceholder}
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? "password-error" : "password-hint"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((errors) => ({ ...errors, password: undefined }));
              setError(null);
            }}
          />
        </AuthField>
        <p id="password-hint" className="text-xs text-neutral-500">
          {d.auth.passwordHint}
        </p>
        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button className="btn w-full" disabled={busy} type="submit">
          {busy ? d.loading : d.signUp}
        </button>
        <p className="text-xs text-neutral-500">{d.agree}</p>
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

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}

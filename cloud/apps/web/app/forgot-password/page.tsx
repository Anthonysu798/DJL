"use client";
import Link from "next/link";
import { useState } from "react";
import {
  AuthField,
  AuthFrame,
  validateAuthForm,
  type AuthFieldErrors,
} from "@/components/AuthFrame";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/locale-context";

export default function ForgotPassword() {
  const { d } = useLocale();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame
      footer={
        <Link href="/sign-in" className="text-neutral-900 underline">
          {d.signIn}
        </Link>
      }
    >
      <h1 className="text-[30px] leading-tight font-medium tracking-tight">{d.auth.forgotTitle}</h1>
      <p className="mt-3 mb-8 text-sm leading-6 text-neutral-500">{d.auth.forgotBody}</p>
      {sent ? (
        <p role="status" className="text-sm leading-6">
          {d.auth.resetSent}
        </p>
      ) : (
        <form
          noValidate
          className="space-y-6"
          onSubmit={async (event) => {
            event.preventDefault();
            const found = validateAuthForm(event.currentTarget, d);
            setErrors(found);
            if (Object.keys(found).length) {
              event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const result = await authClient.requestPasswordReset({
                email: email.trim(),
                redirectTo: `${window.location.origin}/reset-password`,
              });
              if (result.error) setError(result.error.message ?? d.error);
              else setSent(true);
            } catch {
              setError(d.error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <AuthField id="email" label={d.email} error={errors.email}>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "email-error" : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                setErrors({});
              }}
            />
          </AuthField>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button className="btn w-full" disabled={busy}>
            {busy ? d.loading : d.auth.sendReset}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}

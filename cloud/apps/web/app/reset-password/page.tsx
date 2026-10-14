"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  AuthField,
  AuthFrame,
  PasswordInput,
  validateAuthForm,
  type AuthFieldErrors,
} from "@/components/AuthFrame";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/locale-context";

function ResetForm() {
  const { d } = useLocale();
  const params = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const invalid = !token || params.has("error");
  return (
    <AuthFrame
      footer={
        <Link
          href={invalid ? "/forgot-password" : "/sign-in"}
          className="text-neutral-900 underline"
        >
          {invalid ? d.auth.forgot : d.signIn}
        </Link>
      }
    >
      <h1 className="text-[30px] font-medium tracking-tight">{d.auth.resetTitle}</h1>
      <p className="mt-3 mb-8 text-sm leading-6 text-neutral-500">{d.auth.resetBody}</p>
      {invalid ? (
        <p role="alert" className="text-sm text-red-700">
          {d.auth.resetInvalid}
        </p>
      ) : done ? (
        <p role="status" className="text-sm leading-6">
          {d.auth.resetDone}
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
              const result = await authClient.resetPassword({
                token: token!,
                newPassword: password,
              });
              if (result.error) setError(result.error.message ?? d.error);
              else setDone(true);
            } catch {
              setError(d.error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <AuthField id="password" label={d.password} error={errors.password}>
            <PasswordInput
              id="password"
              required
              minLength={10}
              maxLength={256}
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-error" : undefined}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
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
            {busy ? d.loading : d.auth.resetAction}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
export default function ResetPassword() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}

"use client";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Field, FormError, invalid } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, setToken, AdminApiError } from "@/lib/api";
import { loginClient } from "@/lib/client";
import { email as emailRule, required, validate } from "@/lib/validation";

const TOTP = /^\d{6}$/;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"login" | "totp" | "enroll">(
    params.get("step") === "totp" ? "enroll" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string; totp?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const joined = params.get("joined");

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(
      { email, password, totp },
      {
        email: emailRule,
        password: required("Password"),
        ...(step === "totp"
          ? { totp: (v: string) => (TOTP.test(v.trim()) ? null : "Enter the 6-digit code.") }
          : {}),
      },
    );
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await admin<{ token: string; admin: { mfaVerified: boolean } }>(
        "/auth/login",
        {
          method: "POST",
          json: {
            email: email.trim(),
            password,
            ...(totp ? { totp: totp.trim() } : {}),
            client: loginClient(),
          },
        },
      );
      setToken(result.token);
      if (result.admin.mfaVerified) router.replace("/");
      else {
        setEnroll(
          await admin<{ secret: string; uri: string }>("/auth/totp/enroll", {
            method: "POST",
            json: {},
          }),
        );
        setStep("enroll");
      }
    } catch (e) {
      const err = e as AdminApiError;
      if (err.code === "totp_required") setStep("totp");
      else if (err.code === "bad_totp") setErrors({ totp: "That code is wrong or expired." });
      else if (err.code === "bad_credentials")
        setFormError("Email or password is wrong. Sign-in attempts are logged.");
      else if (err.code === "locked_out")
        setFormError("Too many failed attempts. Wait 15 minutes and try again.");
      else if (err.code === "ip_blocked" || err.code === "ip_not_allowed")
        setFormError("This network cannot reach the admin console.");
      else setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!TOTP.test(totp.trim())) {
      setErrors({ totp: "Enter the 6-digit code from your authenticator." });
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await admin("/auth/totp/confirm", { method: "POST", json: { code: totp.trim() } });
      router.replace("/");
    } catch {
      setErrors({ totp: "That code is wrong. Check the time on your phone and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-sm p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary">
            <span className="size-4 rounded-full border-[3px] border-primary-foreground" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">DJL Admin</h1>
            <p className="text-xs text-muted-foreground">
              Internal tool · restricted networks only
            </p>
          </div>
        </div>
        {joined ? (
          <p className="mb-4 rounded-lg border border-success-fg/20 bg-success-bg px-3 py-2 text-[13px] text-success-fg">
            Your email is verified and your password is set. Sign in to continue.
          </p>
        ) : null}
        {step !== "enroll" ? (
          <form onSubmit={login} className="space-y-4" noValidate>
            <Field id="email" label="Email" error={errors.email}>
              <Input
                id="email"
                type="text"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors(({ email: _drop, ...rest }) => rest);
                }}
                className="h-11 rounded-xl"
                {...invalid("email", errors.email)}
              />
            </Field>
            <Field id="password" label="Password" error={errors.password}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors(({ password: _drop, ...rest }) => rest);
                }}
                className="h-11 rounded-xl"
                {...invalid("password", errors.password)}
              />
            </Field>
            {step === "totp" ? (
              <Field id="totp" label="Authenticator code" error={errors.totp}>
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totp}
                  onChange={(e) => {
                    setTotp(e.target.value.replace(/\D/g, ""));
                    if (errors.totp) setErrors(({ totp: _drop, ...rest }) => rest);
                  }}
                  className="h-11 rounded-xl font-mono tracking-[0.3em]"
                  {...invalid("totp", errors.totp)}
                />
              </Field>
            ) : null}
            <FormError error={formError} />
            <Button className="h-11 w-full rounded-xl" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-4" noValidate>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <KeyRound className="mt-0.5 size-4 shrink-0" />
              Every admin needs an authenticator. Add this secret to your authenticator app, then
              enter the current code.
            </p>
            {enroll ? (
              <div className="rounded-xl border bg-secondary p-3">
                <p className="font-mono text-xs break-all">{enroll.secret}</p>
                <Link
                  className="mt-2 inline-block text-xs text-primary underline"
                  href={enroll.uri}
                >
                  Open in authenticator app
                </Link>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  admin<{ secret: string; uri: string }>("/auth/totp/enroll", {
                    method: "POST",
                    json: {},
                  }).then(setEnroll)
                }
              >
                Generate secret
              </Button>
            )}
            <Field id="code" label="Current code" error={errors.totp}>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totp}
                onChange={(e) => {
                  setTotp(e.target.value.replace(/\D/g, ""));
                  if (errors.totp) setErrors({});
                }}
                className="h-11 rounded-xl font-mono tracking-[0.3em]"
                {...invalid("code", errors.totp)}
              />
            </Field>
            <FormError error={formError} />
            <Button className="h-11 w-full rounded-xl" disabled={busy || !enroll} type="submit">
              Confirm
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

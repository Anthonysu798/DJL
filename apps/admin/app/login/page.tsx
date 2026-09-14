"use client";
import { Activity, KeyRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Spotlight } from "@/components/Spotlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { admin, setToken } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await admin<{ token: string; admin: { mfaVerified: boolean } }>(
        "/auth/login",
        { method: "POST", json: { email, password, ...(totp ? { totp } : {}) } },
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
      if ((e as { code?: string }).code === "totp_required") setStep("totp");
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await admin("/auth/totp/confirm", { method: "POST", json: { code: totp } });
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" />
      <div className="glass-strong relative z-10 w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary shadow-[0_0_40px_-6px_var(--color-primary)]">
            <Activity className="size-5 text-white" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">DJL Admin</h1>
            <p className="text-xs text-muted-foreground">
              Internal tool · restricted networks only
            </p>
          </div>
        </div>
        {step !== "enroll" ? (
          <form onSubmit={login} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-xl bg-white/[0.04]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-xl bg-white/[0.04]"
              />
            </div>
            {step === "totp" ? (
              <div className="space-y-1.5">
                <Label htmlFor="totp">Authenticator code</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  className="h-11 rounded-xl bg-white/[0.04] font-mono tracking-[0.3em]"
                />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              className="h-11 w-full rounded-xl shadow-[0_10px_30px_-10px_var(--color-primary)]"
              disabled={busy}
              type="submit"
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <KeyRound className="mt-0.5 size-4 shrink-0" />
              Every admin needs an authenticator. Add this secret to your authenticator app, then
              enter the current code.
            </p>
            {enroll ? (
              <div className="glass p-3">
                <p className="font-mono text-xs break-all">{enroll.secret}</p>
                <a className="mt-2 inline-block text-xs underline" href={enroll.uri}>
                  Open in authenticator app
                </a>
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
            <div className="space-y-1.5">
              <Label htmlFor="code">Current code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                className="h-11 rounded-xl bg-white/[0.04] font-mono tracking-[0.3em]"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
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

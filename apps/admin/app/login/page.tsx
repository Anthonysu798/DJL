"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

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
        const e = await admin<{ secret: string; uri: string }>("/auth/totp/enroll", {
          method: "POST",
          json: {},
        });
        setEnroll(e);
        setStep("enroll");
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "totp_required") setStep("totp");
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
    <main className="mx-auto max-w-sm px-4 py-16">
      <div className="card space-y-4">
        <h1 className="text-lg font-semibold">DJL Admin</h1>
        {step !== "enroll" ? (
          <form onSubmit={login} className="space-y-3">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {step === "totp" ? (
              <div>
                <label className="label" htmlFor="totp">
                  Authenticator code
                </label>
                <input
                  id="totp"
                  className="input font-mono"
                  inputMode="numeric"
                  required
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
            <button className="btn w-full" disabled={busy} type="submit">
              Sign in
            </button>
          </form>
        ) : (
          <form onSubmit={confirm} className="space-y-3">
            <p className="text-sm">
              Every admin needs an authenticator. Add this secret to your authenticator app, then
              enter the current code.
            </p>
            {enroll ? (
              <>
                <p className="break-all font-mono text-xs">{enroll.secret}</p>
                <a className="text-xs underline" href={enroll.uri}>
                  Open in authenticator
                </a>
              </>
            ) : (
              <button
                className="btn-secondary"
                type="button"
                onClick={() =>
                  admin<{ secret: string; uri: string }>("/auth/totp/enroll", {
                    method: "POST",
                    json: {},
                  }).then(setEnroll)
                }
              >
                Generate secret
              </button>
            )}
            <div>
              <label className="label" htmlFor="code">
                Current code
              </label>
              <input
                id="code"
                className="input font-mono"
                inputMode="numeric"
                required
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
            <button className="btn w-full" disabled={busy || !enroll} type="submit">
              Confirm
            </button>
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

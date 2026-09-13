"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/locale-context";

function SignInForm() {
  const { d } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/account";
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
    <div className="card space-y-5">
      <h1 className="text-xl font-semibold">{d.signIn}</h1>
      <form onSubmit={submit} className="space-y-3">
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            {d.password}
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
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <button className="btn w-full" disabled={busy} type="submit">
          {d.continue}
        </button>
      </form>
      <div className="text-center text-xs text-neutral-500">{d.orContinueWith}</div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-secondary" type="button" onClick={() => void social("google")}>
          {d.google}
        </button>
        <button className="btn-secondary" type="button" onClick={() => void social("apple")}>
          {d.apple}
        </button>
      </div>
      <p className="text-sm text-neutral-600">
        {d.noAccount}{" "}
        <Link className="underline" href={`/sign-up?next=${encodeURIComponent(next)}`}>
          {d.signUp}
        </Link>
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

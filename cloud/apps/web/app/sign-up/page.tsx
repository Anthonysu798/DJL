"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";
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
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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

  return (
    <div className="card space-y-5">
      <h1 className="text-xl font-semibold">{d.signUp}</h1>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="name">
            {d.name}
          </label>
          <input
            id="name"
            className="input"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
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
            autoComplete="new-password"
            minLength={10}
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
        <p className="text-xs text-neutral-500">{d.agree}</p>
      </form>
      <p className="text-sm text-neutral-600">
        {d.haveAccount}{" "}
        <Link className="underline" href={`/sign-in?next=${encodeURIComponent(next)}`}>
          {d.signIn}
        </Link>
      </p>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}

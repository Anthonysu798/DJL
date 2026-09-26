"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { safeNext } from "@/lib/safeNext";

function VerifyForm() {
  const { d } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const next = safeNext(params.get("next"));
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.verifyEmail({ email, otp });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? d.error);
      return;
    }
    router.push(next);
  };

  return (
    <div className="card space-y-5">
      <h1 className="text-xl font-semibold">{d.verifyTitle}</h1>
      <p className="text-sm text-neutral-600">{fill(d.verifyBody, { email })}</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="otp">
            {d.code}
          </label>
          <input
            id="otp"
            className="input font-mono tracking-widest"
            inputMode="numeric"
            pattern="[0-9]{6}"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <button className="btn w-full" disabled={busy} type="submit">
          {d.verify}
        </button>
      </form>
      <button
        className="text-sm underline"
        type="button"
        onClick={() =>
          void authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" })
        }
      >
        {d.resend}
      </button>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}

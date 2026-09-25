"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AuthGate } from "@/components/AuthGate";
import { AUTH_URL } from "@/lib/config";
import { useLocale } from "@/lib/locale-context";

type Phase = "claiming" | "ready" | "approved" | "denied" | "error";

/**
 * OAuth device flow approval page. The desktop or iOS app shows a short code;
 * the signed-in user claims it here (GET /device), then approves or denies.
 */
function DeviceApproval() {
  const { d } = useLocale();
  const params = useSearchParams();
  const initial = params.get("user_code") ?? "";
  const [userCode, setUserCode] = useState(initial);
  const [phase, setPhase] = useState<Phase>(initial ? "claiming" : "ready");
  const [error, setError] = useState<string | null>(null);

  const claim = async (code: string) => {
    setError(null);
    const res = await fetch(`${AUTH_URL}/device?user_code=${encodeURIComponent(code)}`, {
      credentials: "include",
    });
    if (!res.ok) {
      setPhase("error");
      setError(d.error);
      return;
    }
    setPhase("ready");
  };

  useEffect(() => {
    if (initial) void claim(initial);
  }, [initial]);

  const decide = async (action: "approve" | "deny") => {
    setError(null);
    const res = await fetch(`${AUTH_URL}/device/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode }),
    });
    if (!res.ok) {
      setPhase("error");
      setError(d.error);
      return;
    }
    setPhase(action === "approve" ? "approved" : "denied");
  };

  return (
    <div className="card space-y-5">
      <h1 className="text-xl font-semibold">{d.deviceTitle}</h1>
      <p className="text-sm text-neutral-600">{d.deviceBody}</p>
      {phase === "approved" ? (
        <p role="status" className="text-sm font-medium text-green-700">
          {d.deviceApproved}
        </p>
      ) : null}
      {phase === "denied" ? (
        <p role="status" className="text-sm font-medium">
          {d.deviceDenied}
        </p>
      ) : null}
      {phase !== "approved" && phase !== "denied" ? (
        <>
          <div>
            <label className="label" htmlFor="user_code">
              {d.deviceCode}
            </label>
            <input
              id="user_code"
              className="input font-mono text-lg tracking-widest"
              value={userCode}
              onChange={(e) => setUserCode(e.target.value.toUpperCase())}
              onBlur={() => userCode && void claim(userCode)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              className="btn"
              type="button"
              disabled={!userCode || phase === "claiming"}
              onClick={() => void decide("approve")}
            >
              {d.approve}
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={!userCode || phase === "claiming"}
              onClick={() => void decide("deny")}
            >
              {d.deny}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function DevicePage() {
  return (
    <Suspense>
      <AuthGateWithCode />
    </Suspense>
  );
}

function AuthGateWithCode() {
  const params = useSearchParams();
  const code = params.get("user_code");
  return (
    <AuthGate next={code ? `/device?user_code=${encodeURIComponent(code)}` : "/device"}>
      <DeviceApproval />
    </AuthGate>
  );
}

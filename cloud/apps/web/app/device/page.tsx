"use client";
import { useSearchParams } from "next/navigation";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { AuthGate } from "@/components/AuthGate";
import CodeSlots from "@/components/CodeSlots";
import { ConnectionShell, OpenDjl } from "@/components/ConnectionShell";
import { AUTH_URL } from "@/lib/config";
import { useLocale } from "@/lib/locale-context";

type Phase = "unverified" | "claiming" | "ready" | "working" | "approved" | "denied" | "error";

function DeviceApproval() {
  const { d } = useLocale();
  const copy = d.connectionUi;
  const params = useSearchParams();
  const initial = params.get("user_code") ?? "";
  const [userCode, setUserCode] = useState(initial);
  const [phase, setPhase] = useState<Phase>(initial ? "claiming" : "unverified");
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(0);
  const deciding = useRef(false);

  const claim = useCallback(
    async (code: string) => {
      const current = ++operation.current;
      setError(null);
      setPhase("claiming");
      try {
        const res = await fetch(`${AUTH_URL}/device?user_code=${encodeURIComponent(code)}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("claim_failed");
        if (current === operation.current) setPhase("ready");
      } catch {
        if (current === operation.current) {
          setPhase("error");
          setError(copy.verifyError);
        }
      }
    },
    [copy.verifyError],
  );

  useEffect(() => {
    if (initial) void claim(initial);
    return () => {
      // This is a request counter, not a DOM ref: invalidate the latest in-flight claim.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      operation.current++;
    };
  }, [initial, claim]);

  const decide = async (action: "approve" | "deny") => {
    if (phase !== "ready" || deciding.current) return;
    deciding.current = true;
    setError(null);
    setPhase("working");
    try {
      const res = await fetch(`${AUTH_URL}/device/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode }),
      });
      if (!res.ok) throw new Error("decision_failed");
      setPhase(action === "approve" ? "approved" : "denied");
    } catch {
      setPhase("error");
      setError(copy.decisionError);
    } finally {
      deciding.current = false;
    }
  };
  const finished = phase === "approved" || phase === "denied";
  const busy = phase === "claiming" || phase === "working";
  return (
    <ConnectionShell
      state={
        phase === "approved"
          ? "connected"
          : phase === "denied"
            ? "denied"
            : phase === "error"
              ? "failed"
              : busy
                ? "working"
                : "ready"
      }
      title={
        phase === "approved" ? copy.connected : phase === "denied" ? copy.denied : d.deviceTitle
      }
      description={finished ? undefined : copy.checkCode}
    >
      {finished ? (
        <>
          <p className="connection-status" role="status">
            {phase === "approved" ? copy.deviceDone : d.deviceDenied}
          </p>
          <OpenDjl />
        </>
      ) : (
        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (phase === "unverified") void claim(userCode);
            else void decide("approve");
          }}
        >
          <label className="connection-label" htmlFor="user_code">
            {d.deviceCode}
          </label>
          <CodeSlots
            id="user_code"
            length={8}
            value={userCode}
            invalid={Boolean(error)}
            ariaDescribedBy={error ? "connection-error" : undefined}
            disabled={phase === "working"}
            onChange={(code) => {
              operation.current++;
              setUserCode(code);
              setPhase("unverified");
              setError(null);
            }}
          />
          {error && (
            <div className="connection-error" id="connection-error">
              <p role="alert">{error}</p>
              <button type="button" onClick={() => void claim(userCode)}>
                <RotateCcw size={12} aria-hidden="true" />
                {copy.retry}
              </button>
            </div>
          )}
          <div className="connection-actions">
            <button
              className="connection-primary"
              type="submit"
              aria-label={phase === "unverified" ? d.continue : copy.approve}
              disabled={userCode.length !== 8 || busy || phase === "error"}
            >
              {busy && <LoaderCircle size={16} className="connection-spin" aria-hidden="true" />}
              {phase === "claiming"
                ? copy.checking
                : phase === "working"
                  ? copy.approving
                  : phase === "unverified"
                    ? d.continue
                    : copy.approve}
            </button>
            <button
              className="connection-text-action"
              type="button"
              disabled={phase !== "ready"}
              onClick={() => void decide("deny")}
            >
              {copy.deny}
            </button>
          </div>
        </form>
      )}
    </ConnectionShell>
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
export default function DevicePage() {
  return (
    <Suspense>
      <AuthGateWithCode />
    </Suspense>
  );
}

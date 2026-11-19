"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ConnectionShell, OpenDjl } from "@/components/ConnectionShell";
import { ArrowRight, RotateCcw } from "lucide-react";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const continuing = new Map<string, Promise<{ status: string }>>();
function continueOnce(userId: string, provider: string, continuation: string) {
  const key = `${userId}:${provider}:${continuation}`;
  let pending = continuing.get(key);
  if (!pending) {
    pending = api<{ status: string }>(`/v1/social/oauth/${provider}/continue`, {
      method: "POST",
      json: { continuation },
    }).finally(() => continuing.delete(key));
    continuing.set(key, pending);
  }
  return pending;
}

function Finish({
  provider,
  continuation,
}: {
  provider: "instagram" | "tiktok";
  continuation: string;
}) {
  const { data } = authClient.useSession();
  const [phase, setPhase] = useState<"working" | "connected" | "failed">("working");
  const userId = data?.user.id;
  const [retry, setRetry] = useState(0);
  const { d } = useLocale();
  const copy = d.connectionUi;
  const name = provider === "instagram" ? "Instagram" : "TikTok";
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function finish() {
      try {
        const result = await continueOnce(userId!, provider, continuation);
        if (!active) return;
        if (result.status === "processing") timer = setTimeout(() => void finish(), 1000);
        else setPhase(result.status === "connected" ? "connected" : "failed");
      } catch {
        if (active) setPhase("failed");
      }
    }
    void finish();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [userId, provider, continuation, retry]);
  return (
    <ConnectionShell
      provider={provider}
      state={phase === "connected" ? "connected" : phase === "failed" ? "failed" : "working"}
      title={
        phase === "connected"
          ? fill(copy.socialTitle, { provider: name })
          : phase === "failed"
            ? copy.failed
            : fill(copy.finishing, { provider: name })
      }
      description={
        phase === "connected"
          ? copy.socialBody
          : phase === "failed"
            ? copy.failedBody
            : copy.finishingBody
      }
    >
      {phase === "connected" ? (
        <>
          <OpenDjl />
          <p className="connection-note" role="status">
            {copy.noPost}
          </p>
        </>
      ) : phase === "failed" ? (
        <>
          <p className="connection-error" role="alert">
            {copy.noPost}
          </p>
          <div className="connection-actions">
            <button
              className="connection-primary"
              type="button"
              onClick={() => {
                setPhase("working");
                setRetry((value) => value + 1);
              }}
            >
              <RotateCcw size={15} aria-hidden="true" />
              {copy.retry}
            </button>
            <Link
              className="connection-text-action"
              href={`/sign-in?next=${encodeURIComponent(`/social/connect?${new URLSearchParams({ provider, continuation })}`)}`}
            >
              {copy.otherAccount}
            </Link>
          </div>
        </>
      ) : (
        <p className="connection-note" role="status">
          {copy.noPost}
        </p>
      )}
    </ConnectionShell>
  );
}
function ConnectGate() {
  const params = useSearchParams();
  const { d } = useLocale();
  const copy = d.connectionUi;
  const provider = params.get("provider");
  const continuation = params.get("continuation");
  if (
    (provider !== "instagram" && provider !== "tiktok") ||
    !continuation ||
    !/^[A-Za-z0-9_-]{43}$/.test(continuation)
  )
    return (
      <ConnectionShell state="failed" title={copy.failed}>
        <p className="connection-status" role="alert">
          {copy.invalid}
        </p>
        <OpenDjl />
      </ConnectionShell>
    );
  const next = `/social/connect?${new URLSearchParams({ provider, continuation })}`;
  return (
    <AuthGate
      next={next}
      signedOut={
        <ConnectionShell
          provider={provider}
          title={copy.signedOut}
          description={copy.signedOutBody}
        >
          <div className="connection-actions">
            <Link className="connection-primary" href={`/sign-in?next=${encodeURIComponent(next)}`}>
              {copy.signIn}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <p className="connection-note">{copy.noPost}</p>
        </ConnectionShell>
      }
    >
      <Finish provider={provider} continuation={continuation} />
    </AuthGate>
  );
}
export default function SocialConnectPage() {
  return (
    <Suspense>
      <ConnectGate />
    </Suspense>
  );
}

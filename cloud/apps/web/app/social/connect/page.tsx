"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
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
  }, [userId, provider, continuation]);
  return (
    <div className="card space-y-4">
      <h1 className="text-xl font-semibold">
        Finish connecting {provider === "instagram" ? "Instagram" : "TikTok"}
      </h1>
      {phase === "connected" ? (
        <p role="status">
          Account connected. Return to DJL Agent Chat to continue. No post has been published.
        </p>
      ) : (
        <>
          <p>Signed in as {data?.user.email}.</p>
          {phase === "working" && <p role="status">Completing your account connection…</p>}
          <p>Connecting an account does not approve or publish any post.</p>
          {phase === "failed" && (
            <>
              <p role="alert">
                Connection could not be completed. Sign in with the DJL account that started it, or
                return to Agent Chat and restart authorization.
              </p>
              <Link
                className="btn-secondary"
                href={`/sign-in?next=${encodeURIComponent(`/social/connect?${new URLSearchParams({ provider, continuation })}`)}`}
              >
                Sign in with another DJL account
              </Link>
            </>
          )}
        </>
      )}
    </div>
  );
}
function ConnectGate() {
  const params = useSearchParams();
  const provider = params.get("provider");
  const continuation = params.get("continuation");
  if (
    (provider !== "instagram" && provider !== "tiktok") ||
    !continuation ||
    !/^[A-Za-z0-9_-]{43}$/.test(continuation)
  )
    return <p role="alert">This connection link is invalid. Start again from DJL Agent Chat.</p>;
  const next = `/social/connect?${new URLSearchParams({ provider, continuation })}`;
  return (
    <AuthGate
      next={next}
      signedOut={
        <div className="card space-y-4">
          <h1 className="text-xl font-semibold">Sign in to DJL to finish connecting</h1>
          <p>
            Use the same DJL account where you started this connection. Nothing has been published.
          </p>
          <Link className="btn" href={`/sign-in?next=${encodeURIComponent(next)}`}>
            Sign in to DJL
          </Link>
        </div>
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

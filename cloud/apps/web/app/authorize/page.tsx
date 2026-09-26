"use client";
import type { CloudNativeAuthCodeResponse } from "@synara/contracts/cloud";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthGate } from "@/components/AuthGate";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

type Phase = "ready" | "working" | "opening" | "canceled" | "error";

interface AuthorizeRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: "S256";
}

/** OAuth-style query from the desktop app; the API re-checks the client and redirect allowlist. */
function readRequest(params: URLSearchParams): AuthorizeRequest | null {
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const codeChallenge = params.get("code_challenge");
  if (!clientId || !redirectUri || !state || !codeChallenge) return null;
  if (params.get("code_challenge_method") !== "S256") return null;
  return { clientId, redirectUri, state, codeChallenge, codeChallengeMethod: "S256" };
}

/**
 * Desktop browser sign-in. The signed-in user confirms, the API mints a
 * single-use code bound to the app's PKCE challenge, and the browser hands it
 * back to the app through its `djl://` redirect. Nothing is redirected unless
 * the API accepted the client and redirect URI.
 */
function Consent({ request }: { request: AuthorizeRequest }) {
  const { d } = useLocale();
  const { data } = authClient.useSession();
  const [phase, setPhase] = useState<Phase>("ready");

  const approve = async () => {
    setPhase("working");
    try {
      const { redirectTo } = await api<CloudNativeAuthCodeResponse>("/v1/native-auth/codes", {
        method: "POST",
        json: request,
      });
      setPhase("opening");
      window.location.href = redirectTo;
    } catch {
      setPhase("error");
    }
  };

  return (
    <div className="card space-y-5">
      <h1 className="text-xl font-semibold">{d.authorizeTitle}</h1>
      {phase === "opening" ? (
        <p role="status" className="text-sm font-medium text-green-700">
          {d.authorizeOpening}
        </p>
      ) : phase === "canceled" ? (
        <p role="status" className="text-sm font-medium">
          {d.authorizeCanceled}
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-600">
            {fill(d.authorizeBody, { email: data?.user.email ?? "" })}
          </p>
          {phase === "error" ? (
            <p role="alert" className="text-sm text-red-600">
              {d.authorizeInvalid}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              className="btn"
              type="button"
              disabled={phase === "working"}
              onClick={() => void approve()}
            >
              {d.authorizeContinue}
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={phase === "working"}
              onClick={() => setPhase("canceled")}
            >
              {d.authorizeCancel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AuthorizeGate() {
  const { d } = useLocale();
  const params = useSearchParams();
  const request = readRequest(params);
  if (!request)
    return (
      <div className="card">
        <p role="alert" className="text-sm text-red-600">
          {d.authorizeInvalid}
        </p>
      </div>
    );
  return (
    <AuthGate next={`/authorize?${params.toString()}`}>
      <Consent request={request} />
    </AuthGate>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense>
      <AuthorizeGate />
    </Suspense>
  );
}

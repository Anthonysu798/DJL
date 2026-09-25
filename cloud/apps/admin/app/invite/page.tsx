"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Field, FormError, invalid } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, AdminApiError } from "@/lib/api";
import { loginClient } from "@/lib/client";
import { password as passwordRule } from "@/lib/validation";

interface Invite {
  email: string;
  name: string;
  role: string;
}

/**
 * Public landing page for the invite link. Opening it verifies the email
 * (only the recipient has the token); setting a password activates the
 * account. The token is used once and then dead.
 */
function InviteForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [invite, setInvite] = useState<Invite | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setDead("This link is missing its token. Ask an admin to send a new invite.");
      return;
    }
    admin<Invite>("/auth/invite/inspect", { method: "POST", json: { token } })
      .then(setInvite)
      .catch((e: AdminApiError) =>
        setDead(
          e.code === "locked_out"
            ? "Too many attempts from this network. Try again later."
            : "This invite link has expired or was already used. Ask an admin to send a new one.",
        ),
      );
  }, [token]);

  const live = password.length > 0 ? passwordRule(invite?.email ?? "")(password) : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    const p = passwordRule(invite?.email ?? "")(password);
    if (p) found.password = p;
    if (confirm !== password) found.confirm = "The two passwords do not match.";
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFormError(null);
    try {
      await admin("/auth/invite/accept", {
        method: "POST",
        json: { token, password, client: loginClient() },
      });
      router.replace("/login?joined=1");
    } catch (err) {
      const apiErr = err as AdminApiError;
      if (apiErr.code === "weak_password") setErrors({ password: apiErr.message });
      else if (apiErr.code === "invalid_invite")
        setDead(
          "This invite link has expired or was already used. Ask an admin to send a new one.",
        );
      else setFormError(apiErr.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-sm p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary">
            <span className="size-4 rounded-full border-[3px] border-primary-foreground" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Join the DJL admin team</h1>
            <p className="text-xs text-muted-foreground">Verify your email and choose a password</p>
          </div>
        </div>
        {dead ? (
          <FormError error={dead} />
        ) : !invite ? (
          <p className="text-sm text-muted-foreground">Checking your invite…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="rounded-xl border bg-secondary px-3 py-2 text-sm">
              <div className="font-medium">{invite.name}</div>
              <div className="text-muted-foreground">
                {invite.email} · {invite.role}
              </div>
            </div>
            <Field
              id="password"
              label="Password"
              hint="At least 14 characters. A sentence you will remember works well."
              error={errors.password ?? live}
            >
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors(({ password: _drop, ...rest }) => rest);
                }}
                className="h-11 rounded-xl"
                {...invalid("password", errors.password ?? live)}
              />
            </Field>
            <Field id="confirm" label="Confirm password" error={errors.confirm}>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  if (errors.confirm) setErrors(({ confirm: _drop, ...rest }) => rest);
                }}
                className="h-11 rounded-xl"
                {...invalid("confirm", errors.confirm)}
              />
            </Field>
            <FormError error={formError} />
            <Button className="h-11 w-full rounded-xl" disabled={busy} type="submit">
              {busy ? "Saving…" : "Set password and continue"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              You will enroll an authenticator app on your first sign-in.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteForm />
    </Suspense>
  );
}

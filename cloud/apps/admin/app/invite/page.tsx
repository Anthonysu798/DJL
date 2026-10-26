"use client";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Field, FormError, invalid } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, AdminApiError } from "@/lib/api";
import { loginClient } from "@/lib/client";
import { password as passwordRule } from "@/lib/validation";
import { useI18n } from "@/components/LocaleProvider";
import { LanguageSelector } from "@/components/LanguageSelector";

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
  const { t } = useI18n();
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
      setDead(t("invite.missing"));
      return;
    }
    admin<Invite>("/auth/invite/inspect", { method: "POST", json: { token } })
      .then(setInvite)
      .catch((e: AdminApiError) =>
        setDead(e.code === "locked_out" ? t("invite.rateLimit") : t("invite.expired")),
      );
  }, [token]);

  const live = password.length > 0 ? passwordRule(invite?.email ?? "")(password) : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    const p = passwordRule(invite?.email ?? "")(password);
    if (p) found.password = p;
    if (confirm !== password) found.confirm = t("invite.passwordMismatch");
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
      else if (apiErr.code === "invalid_invite") setDead(t("invite.expired"));
      else setFormError(apiErr.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-sm p-8 shadow-sm">
        <div className="mb-4 flex justify-end">
          <LanguageSelector />
        </div>
        <div className="mb-6 flex items-center gap-3">
          <Image
            src="/djl-logo.png"
            alt="DJL"
            width={40}
            height={40}
            className="size-10 object-contain"
          />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t("invite.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("invite.description")}</p>
          </div>
        </div>
        {dead ? (
          <FormError error={dead} />
        ) : !invite ? (
          <p className="text-sm text-muted-foreground">{t("invite.checking")}</p>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="rounded-xl border bg-secondary px-3 py-2 text-sm">
              <div className="font-medium">{invite.name}</div>
              <div className="text-muted-foreground">
                {invite.email} · {invite.role === "admin" ? t("role.admin") : t("role.employee")}
              </div>
            </div>
            <Field
              id="password"
              label={t("auth.password")}
              hint={t("invite.passwordHint")}
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
            <Field id="confirm" label={t("invite.confirmPassword")} error={errors.confirm}>
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
              {busy ? t("common.saving") : t("invite.continue")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("invite.enrollment")}</p>
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

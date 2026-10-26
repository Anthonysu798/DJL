"use client";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Eye, EyeOff, Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { Field, FormError, invalid } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { admin, setToken, AdminApiError } from "@/lib/api";
import { loginClient } from "@/lib/client";
import { email as emailRule, required, validate } from "@/lib/validation";

import { AuthenticatorSetup } from "./AuthenticatorSetup";
import styles from "./login.module.css";
import { VerificationCode } from "./VerificationCode";
import { useI18n } from "@/components/LocaleProvider";
import { LanguageSelector } from "@/components/LanguageSelector";

gsap.registerPlugin(useGSAP);

const TOTP = /^\d{6}$/;

function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"login" | "totp" | "enroll">(
    params.get("step") === "totp" ? "enroll" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string; totp?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          gsap
            .timeline({ defaults: { ease: "power2.out", duration: 0.65 } })
            .from(".login-art", { opacity: 0, scale: 0.98 })
            .from(".login-reveal", { opacity: 0, y: 16, stagger: 0.12 }, 0.1);
        },
        root,
      );
      return () => media.revert();
    },
    { scope: root },
  );
  const joined = params.get("joined");

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(
      { email, password, totp },
      {
        email: emailRule,
        password: required(t("auth.password")),
        ...(step === "totp"
          ? { totp: (v: string) => (TOTP.test(v.trim()) ? null : t("auth.enterCode")) }
          : {}),
      },
    );
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await admin<{ token: string; admin: { mfaVerified: boolean } }>(
        "/auth/login",
        {
          method: "POST",
          json: {
            email: email.trim(),
            password,
            ...(totp ? { totp: totp.trim() } : {}),
            client: loginClient(),
          },
        },
      );
      setToken(result.token);
      if (result.admin.mfaVerified) router.replace("/");
      else {
        setEnroll(
          await admin<{ secret: string; uri: string }>("/auth/totp/enroll", {
            method: "POST",
            json: {},
          }),
        );
        setStep("enroll");
      }
    } catch (e) {
      const err = e as AdminApiError;
      if (err.code === "totp_required") setStep("totp");
      else if (err.code === "bad_totp") setErrors({ totp: t("auth.badCode") });
      else if (err.code === "bad_credentials") setFormError(t("auth.badCredentials"));
      else if (err.code === "locked_out") setFormError(t("auth.lockedOut"));
      else if (err.code === "ip_blocked" || err.code === "ip_not_allowed")
        setFormError(t("auth.ipBlocked"));
      else setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!TOTP.test(totp.trim())) {
      setErrors({ totp: t("auth.enterAuthenticatorCode") });
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await admin("/auth/totp/confirm", { method: "POST", json: { code: totp.trim() } });
      router.replace("/");
    } catch {
      setErrors({ totp: t("auth.checkClock") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main ref={root} className={styles.page}>
      <aside className={styles.artPanel} aria-hidden="true">
        <div className={styles.artFrame}>
          <Image
            src="/admin-login-art.png"
            alt=""
            fill
            sizes="(max-width: 760px) 1px, 52vw"
            priority
            className="login-art"
          />
        </div>
      </aside>

      <section className={styles.formPanel} aria-label={t("auth.region")}>
        <header className={styles.navigation}>
          <Link href="/login" className={styles.brand} aria-label={t("auth.brand")}>
            <Image src="/djl-logo.png" alt="" width={36} height={36} className={styles.brandLogo} />
            DJL<span>{t("role.admin")}</span>
          </Link>
          <LanguageSelector />
          <details className={styles.help}>
            <summary aria-label={t("auth.help")}>
              <Menu size={24} aria-hidden="true" />
            </summary>
            <div className={styles.helpContent}>
              <p>{t("auth.authorized")}</p>
              <Link href="https://staging.slcor.com">{t("auth.openDJL")}</Link>
            </div>
          </details>
        </header>

        <div
          className={
            step === "enroll" ? `${styles.content} ${styles.enrollmentContent}` : styles.content
          }
        >
          <div className={`${styles.intro} login-reveal`}>
            <h1>
              {step === "enroll"
                ? t("auth.secureTitle")
                : step === "totp"
                  ? t("auth.verifyTitle")
                  : t("auth.welcome")}
            </h1>
            <p>
              {step === "enroll"
                ? t("auth.connectAuthenticator")
                : step === "totp"
                  ? t("auth.verifyAuthenticator")
                  : t("auth.signInDescription")}
            </p>
          </div>
          {joined ? (
            <p role="status" className={styles.notice}>
              {t("auth.joined")}
            </p>
          ) : null}
          {step !== "enroll" ? (
            <form
              onSubmit={login}
              className={`${styles.form} login-reveal`}
              noValidate
              aria-busy={busy}
            >
              <Field id="email" label={t("auth.email")} error={errors.email}>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  disabled={busy}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors(({ email: _drop, ...rest }) => rest);
                  }}
                  className={styles.input}
                  {...invalid("email", errors.email)}
                />
              </Field>
              <Field id="password" label={t("auth.password")} error={errors.password}>
                <div className={styles.passwordField}>
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    disabled={busy}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) setErrors(({ password: _drop, ...rest }) => rest);
                    }}
                    className={styles.input}
                    {...invalid("password", errors.password)}
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                    aria-pressed={showPassword}
                    disabled={busy}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? (
                      <EyeOff size={20} aria-hidden="true" />
                    ) : (
                      <Eye size={20} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </Field>
              {step === "totp" ? (
                <Field id="totp" label={t("auth.authenticatorCode")} error={errors.totp}>
                  <VerificationCode
                    id="totp"
                    value={totp}
                    disabled={busy}
                    error={errors.totp}
                    onChange={(value) => {
                      setTotp(value);
                      if (errors.totp) setErrors(({ totp: _drop, ...rest }) => rest);
                    }}
                  />
                </Field>
              ) : null}
              <FormError error={formError} />
              <Button className={styles.submit} disabled={busy} type="submit">
                {busy ? t("auth.signingIn") : t("auth.signIn")}
              </Button>
              <details className={styles.recovery}>
                <summary>{t("auth.forgotPassword")}</summary>
                <p>{t("auth.recovery")}</p>
              </details>
            </form>
          ) : (
            <form
              onSubmit={confirm}
              className={`${styles.form} login-reveal`}
              noValidate
              aria-busy={busy}
            >
              {enroll ? (
                <AuthenticatorSetup key={enroll.uri} secret={enroll.secret} uri={enroll.uri} />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  className={styles.generate}
                  onClick={async () => {
                    setBusy(true);
                    setFormError(null);
                    try {
                      setEnroll(
                        await admin<{ secret: string; uri: string }>("/auth/totp/enroll", {
                          method: "POST",
                          json: {},
                        }),
                      );
                    } catch (e) {
                      setFormError((e as AdminApiError).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? t("auth.generating") : t("auth.generateSecret")}
                </Button>
              )}
              <Field id="code" label={t("auth.verificationCode")} error={errors.totp}>
                <VerificationCode
                  id="code"
                  value={totp}
                  disabled={busy}
                  error={errors.totp}
                  onChange={(value) => {
                    setTotp(value);
                    if (errors.totp) setErrors(({ totp: _drop, ...rest }) => rest);
                  }}
                />
              </Field>
              <FormError error={formError} />
              <Button
                className={styles.submit}
                disabled={busy || !enroll || !TOTP.test(totp)}
                type="submit"
              >
                {busy ? t("auth.verifying") : t("auth.verifyContinue")}
              </Button>
            </form>
          )}
        </div>
        <footer className={styles.footer}>{t("auth.footer")}</footer>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

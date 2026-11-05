"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { AuthField, PasswordInput } from "@/components/AuthFrame";
import { ScopedShopAdmission } from "@/components/commerce/ScopedShopSession";
import { scopedShopReturn, signInScopedShop, verifyScopedShopTotp } from "@/lib/scoped-shop";

function PilotSignInForm() {
  const router = useRouter();
  const query = useSearchParams();
  const next = scopedShopReturn(query.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorEmail, setFactorEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const challengeHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (factorEmail) challengeHeading.current?.focus();
  }, [factorEmail]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    if (factorEmail && !/^\d{6}$/.test(code.trim())) {
      setError("请输入验证器中的 6 位验证码。");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    const current = () => request.current === controller && !controller.signal.aborted;
    try {
      if (factorEmail) {
        await verifyScopedShopTotp(factorEmail, code.trim(), controller.signal);
        if (current()) router.replace(next);
        return;
      }
      const result = await signInScopedShop(email, password, controller.signal);
      if (!current()) return;
      setPassword("");
      if (result === "totp") {
        setCode("");
        setFactorEmail(email.trim());
      } else if (result === "unsupported_factor") {
        setError("此账号需要其他验证方式；本地测试商城目前只支持验证器验证码。");
      } else router.replace(next);
    } catch {
      if (!current()) return;
      if (factorEmail) setCode("");
      setError(
        factorEmail ? "验证码未确认，请检查后重试。" : "测试商城登录未确认，请检查账号后重试。",
      );
    } finally {
      if (current()) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-8">
      <Link href={next} className="font-medium underline">
        返回商城
      </Link>
      <div>
        <p className="text-sm">本地独立测试商城 · 不涉及真实资金</p>
        <h1
          ref={challengeHeading}
          tabIndex={factorEmail ? -1 : undefined}
          className="mt-2 text-3xl font-semibold"
        >
          {factorEmail ? "验证器确认" : "登录测试商城"}
        </h1>
        <p className="mt-3 text-sm">
          {factorEmail
            ? "输入验证器生成的 6 位验证码。"
            : "请使用已验证的测试账号。本页不提供注册或密码重置。"}
        </p>
      </div>
      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        {factorEmail ? (
          <AuthField id="shop-totp" label="验证码" error={undefined}>
            <input
              id="shop-totp"
              className="input"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={busy}
              maxLength={6}
            />
          </AuthField>
        ) : (
          <>
            <AuthField id="shop-email" label="邮箱" error={undefined}>
              <input
                id="shop-email"
                className="input"
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </AuthField>
            <AuthField id="shop-password" label="密码" error={undefined}>
              <PasswordInput
                id="shop-password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </AuthField>
          </>
        )}
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button className="btn w-full" disabled={busy}>
          {busy ? "正在确认…" : factorEmail ? "验证并登录" : "登录"}
        </button>
        {factorEmail ? (
          <button
            type="button"
            className="underline"
            disabled={busy}
            onClick={() => {
              setCode("");
              setFactorEmail(null);
              setError(null);
            }}
          >
            返回账号登录
          </button>
        ) : null}
      </form>
    </main>
  );
}

export default function ScopedShopSignInPage() {
  return (
    <ScopedShopAdmission>
      <Suspense fallback={<p role="status">正在准备登录…</p>}>
        <PilotSignInForm />
      </Suspense>
    </ScopedShopAdmission>
  );
}

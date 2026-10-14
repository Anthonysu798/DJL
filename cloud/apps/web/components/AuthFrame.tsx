"use client";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Eye, EyeOff, AlertCircle } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { AiNotice } from "./AiNotice";
import { useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

import { DjlLogo } from "@/components/DjlLogo";
import type { Dict } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

export function AuthFrame({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const { d } = useLocale();
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".auth-form-content", { y: 16, opacity: 0, duration: 0.55, ease: "power2.out" });
        gsap.from(".auth-portrait", {
          y: 32,
          opacity: 0,
          duration: 0.8,
          delay: 0.12,
          ease: "power2.out",
        });
      });
      return () => media.revert();
    },
    { scope },
  );
  return (
    <main ref={scope} className="auth-frame grid min-h-dvh w-full overflow-x-hidden lg:grid-cols-2">
      <section className="flex min-h-dvh flex-col px-6 sm:px-12">
        <header className="flex h-24 shrink-0 items-center">
          <Link href="/chat" className="flex items-center gap-2 text-xl font-medium tracking-tight">
            <DjlLogo className="size-10" /> DJL Cloud
          </Link>
        </header>
        <div className="auth-form-content mx-auto flex w-full max-w-[336px] flex-1 flex-col justify-center py-10">
          {children}
          <p className="mt-8 text-center text-[13px] text-[#667085]">{footer}</p>
        </div>
        <footer className="mx-auto max-w-md pb-6">
          <AiNotice />
        </footer>
      </section>
      <aside
        className="auth-portrait relative hidden min-h-dvh overflow-hidden bg-[#b2bdcb] lg:block"
        aria-label={d.auth.previewLabel}
      >
        <Image
          src="/auth-portrait-glass.png"
          alt=""
          fill
          priority
          sizes="50vw"
          className="object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#101828]/75 via-transparent to-transparent" />
        <div className="absolute right-10 bottom-14 left-10 text-white xl:right-12 xl:left-12">
          <h2 className="max-w-xl text-[clamp(1.75rem,2.7vw,2.65rem)] leading-[1.3] font-medium tracking-tight">
            {d.auth.previewTitle}
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/85">{d.auth.previewBody}</p>
          <p className="mt-8 text-lg font-medium">DJL Cloud</p>
          <p className="mt-1 text-sm text-white/75">{d.auth.previewNote}</p>
        </div>
      </aside>
    </main>
  );
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { d } = useLocale();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className="input pr-12" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? d.auth.hidePassword : d.auth.showPassword}
        className="absolute top-0 right-0 flex h-full w-12 items-center justify-center rounded-r-xl text-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function ProviderIcon({ provider }: { provider: "google" | "apple" }) {
  return provider === "google" ? (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.61-2.42l-3.24-2.51c-.9.6-2.04.97-3.37.97-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.05a10 10 0 0 0 0 9.02l3.35-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.35 2.59A5.99 5.99 0 0 1 12 5.96Z"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
      <path d="M17.1 12.3c0-2 1.6-3 1.7-3.1-1-1.5-2.6-1.7-3.2-1.7-1.4-.2-2.7.8-3.4.8-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.6 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.1 2.6 2.1 1.1 0 1.4-.7 2.7-.7s1.6.7 2.8.7c1.2 0 1.9-1 2.6-2 .8-1.2 1.2-2.4 1.2-2.5-.1 0-2.5-1-2.5-3.6ZM14.9 6.1c.6-.8 1.1-1.9 1-3.1-1 .1-2.1.7-2.8 1.5-.6.7-1.1 1.8-1 2.9 1.1.1 2.2-.5 2.8-1.3Z" />
    </svg>
  );
}

export type AuthFieldErrors = Record<string, string | undefined>;

export function validateAuthForm(form: HTMLFormElement, d: Dict): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  for (const input of form.querySelectorAll<HTMLInputElement>("input[required]")) {
    if (!input.value || (input.id !== "password" && !input.value.trim())) {
      errors[input.id] =
        input.id === "email"
          ? d.auth.emailRequired
          : input.id === "name"
            ? d.auth.nameRequired
            : d.auth.passwordRequired;
    } else if (input.type === "email" && input.validity.typeMismatch) {
      errors[input.id] = d.auth.emailInvalid;
    } else if (input.minLength > 0 && input.value.length < input.minLength) {
      errors[input.id] = d.auth.passwordHint;
    }
  }
  return errors;
}

export function AuthField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-[13px] leading-5 text-red-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

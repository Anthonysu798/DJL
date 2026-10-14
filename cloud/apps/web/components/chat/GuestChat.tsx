"use client";
import { ArrowUp, CreditCard, Plus, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AiNotice } from "@/components/AiNotice";
import { DjlLogo } from "@/components/DjlLogo";
import { ProviderIcon } from "@/components/AuthFrame";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { APPLE_SIGN_IN_ENABLED, GOOGLE_SIGN_IN_ENABLED } from "@/lib/config";
import { useLocale } from "@/lib/locale-context";

/** Public welcome screen. Cloud requests and saved conversations still require sign-in. */
export function GuestChat() {
  const { d } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const social = async (provider: "google" | "apple") => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: `${window.location.origin}/chat`,
      });
      if (result.error) setError(result.error.message ?? d.error);
    } catch {
      setError(d.error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="guest-chat flex min-h-dvh">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-white/10 p-3 md:flex">
        <Link href="/chat" className="mb-6 flex items-center gap-2 px-2 text-lg font-medium">
          <DjlLogo className="size-8 brightness-0 invert" /> DJL
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-3 text-sm"
        >
          <SquarePen className="size-4" />
          {d.chat.newChat}
        </button>
        <Link
          href="/billing"
          className="mt-auto flex items-center gap-3 px-3 py-4 text-sm text-neutral-300"
        >
          <CreditCard className="size-4" />
          {d.billing}
        </Link>
        <div className="border-t border-white/10 px-3 py-5 text-sm">
          <p className="font-medium">{d.auth.signInTitle}</p>
          <p className="mt-2 leading-6 text-neutral-500">{d.auth.welcomeBody}</p>
          <button
            onClick={() => setOpen(true)}
            className="mt-5 w-full rounded-full border border-white/10 bg-white/5 py-2.5"
          >
            {d.signIn}
          </button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 items-center justify-between gap-3 px-5 sm:px-8">
          <span className="text-lg font-medium">DJL Cloud</span>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setOpen(true)}
              className="rounded-full bg-white px-4 py-2.5 text-black"
            >
              {d.signIn}
            </button>
            <Link href="/sign-up" className="rounded-full bg-white/10 px-4 py-2.5">
              {d.signUp}
            </Link>
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 pb-24">
          <h1 className="mb-9 text-center text-[clamp(1.75rem,3vw,2.1rem)] font-medium tracking-tight">
            {d.chat.emptyTitle}
          </h1>
          <button
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-4 rounded-full border border-white/5 bg-[#212121] p-3 text-left text-neutral-400"
          >
            <Plus className="ml-2 size-5" aria-hidden />
            <span className="flex-1">{d.chat.placeholder}</span>
            <span className="flex size-10 items-center justify-center rounded-full bg-white text-black">
              <ArrowUp className="size-5" />
            </span>
          </button>
        </div>
        <footer className="mx-auto w-full max-w-3xl px-6 pb-5">
          <AiNotice />
        </footer>
      </main>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="guest-welcome max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-[20px] px-7 py-10 sm:max-w-[464px] sm:px-7 sm:py-12"
          showCloseButton={false}
        >
          <DialogTitle className="text-center text-[32px] leading-tight font-normal tracking-tight">
            {d.auth.signInTitle}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-6 mb-10 max-w-[320px] text-center text-[17px] leading-7">
            {d.auth.welcomeBody}
          </DialogDescription>
          <div className="flex flex-col gap-3">
            {GOOGLE_SIGN_IN_ENABLED && (
              <button
                disabled={busy}
                onClick={() => void social("google")}
                className="flex h-14 items-center justify-center gap-2 rounded-full border border-[#414141] text-base hover:bg-white/5"
              >
                <ProviderIcon provider="google" />
                {d.auth.welcomeGoogle}
              </button>
            )}
            {APPLE_SIGN_IN_ENABLED && (
              <button
                disabled={busy}
                onClick={() => void social("apple")}
                className="flex h-14 items-center justify-center gap-2 rounded-full border border-[#414141] text-base hover:bg-white/5"
              >
                <ProviderIcon provider="apple" />
                {d.auth.welcomeApple}
              </button>
            )}
          </div>
          <div className="my-7 flex items-center gap-6 text-xs text-neutral-400">
            <span className="h-px flex-1 bg-[#414141]" />
            {d.auth.or}
            <span className="h-px flex-1 bg-[#414141]" />
          </div>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("email") as HTMLInputElement;
              if (!email.trim() || input.validity.typeMismatch) {
                setError(!email.trim() ? d.auth.emailRequired : d.auth.emailInvalid);
                input.focus();
                return;
              }
              router.push(`/sign-in?email=${encodeURIComponent(email.trim())}`);
            }}
          >
            <label htmlFor="welcome-email" className="sr-only">
              {d.email}
            </label>
            <input
              id="welcome-email"
              name="email"
              type="email"
              autoComplete="email"
              className="input"
              placeholder={d.email}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
              aria-invalid={!!error}
              aria-describedby={error ? "welcome-error" : undefined}
            />
            {error && (
              <p id="welcome-error" role="alert" className="mt-2 text-sm text-[#f97066]">
                {error}
              </p>
            )}
            <button
              disabled={busy}
              className="mt-5 h-14 w-full rounded-full bg-[#f5f5f5] text-base font-medium text-[#171717]"
              type="submit"
            >
              {busy ? d.loading : d.auth.emailContinue}
            </button>
          </form>
          <button
            onClick={() => setOpen(false)}
            className="mx-auto mt-6 text-sm text-neutral-300 underline underline-offset-4"
          >
            {d.auth.stayLoggedOut}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

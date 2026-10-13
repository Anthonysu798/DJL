"use client";
import { CreditCard, Gauge, Monitor, Settings, Sun, UserRound, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AccountPanel, DevicesPanel } from "@/components/account/AccountPanels";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/components/theme";
import { useLocale } from "@/lib/locale-context";
import { UsageMeter } from "./Usage";
import { useChat } from "@/lib/chat/context";

export function SettingsNav({ onNavigate }: { onNavigate?: () => void }) {
  const { d } = useLocale();
  const params = useSearchParams();
  const tab = params.get("tab") ?? "general";
  return (
    <nav className="flex h-full flex-col bg-sidebar p-3" aria-label={d.workspace.settings}>
      <h1 className="px-3 py-4 text-base font-semibold">{d.workspace.settings}</h1>
      <Link
        onClick={() => onNavigate?.()}
        href="/chat"
        className="mb-8 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
      >
        <ArrowLeft className="size-4" />
        {d.chat.backToChats}
      </Link>
      <p className="mb-2 px-3 text-xs text-muted-foreground">{d.workspace.personal}</p>
      {(
        [
          ["general", d.workspace.general, Settings],
          ["appearance", d.workspace.appearance, Sun],
          ["usage", d.chat.usage, Gauge],
          ["account", d.account, UserRound],
          ["devices", d.devices, Monitor],
        ] as const
      ).map(([id, label, Icon]) => {
        return (
          <Link
            onClick={() => onNavigate?.()}
            key={id}
            href={`/chat/settings?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${tab === id ? "bg-accent" : "hover:bg-accent"}`}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
      <Link
        onClick={() => onNavigate?.()}
        href="/billing"
        className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm hover:bg-accent"
      >
        <CreditCard className="size-4" />
        {d.billing}
      </Link>
    </nav>
  );
}

function SettingsContent() {
  const { d, locale } = useLocale();
  const { theme, setTheme } = useTheme();
  const usage = useChat((s) => s.usage);
  const tab = useSearchParams().get("tab") ?? "general";
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-6 py-12 sm:px-10 md:py-16">
      <div className="mx-auto max-w-[820px]">
        <h2 className="mb-10 text-[28px] font-medium tracking-tight">
          {tab === "appearance"
            ? d.workspace.appearance
            : tab === "usage"
              ? d.chat.usage
              : tab === "account"
                ? d.account
                : tab === "devices"
                  ? d.devices
                  : d.workspace.general}
        </h2>
        {tab === "account" ? (
          <AccountPanel />
        ) : tab === "devices" ? (
          <DevicesPanel />
        ) : tab === "appearance" ? (
          <div className="cloud-settings-row">
            <div>
              <p className="text-sm font-medium">{d.workspace.theme}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d.workspace.themeHint}</p>
            </div>
            <Select value={theme} onValueChange={(value) => setTheme(value as "dark" | "light")}>
              <SelectTrigger aria-label={d.workspace.theme} className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectGroup>
                  <SelectItem value="dark">{d.darkMode}</SelectItem>
                  <SelectItem value="light">{d.lightMode}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : tab === "usage" ? (
          <div className="rounded-2xl border border-border p-6">
            {usage ? <UsageMeter usage={usage} /> : <p>{d.loading}</p>}
            <Link
              href="/billing"
              className="mt-6 inline-block text-sm underline underline-offset-4"
            >
              {d.manageBilling}
            </Link>
          </div>
        ) : (
          <div className="cloud-settings-row">
            <div>
              <p className="text-sm font-medium">{d.workspace.language}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d.workspace.languageHint}</p>
            </div>
            <Select
              value={locale}
              onValueChange={(value) => {
                document.cookie = `djl_locale=${value};path=/;max-age=31536000;SameSite=Lax`;
                window.location.reload();
              }}
            >
              <SelectTrigger aria-label={d.workspace.language} className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                <SelectGroup>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh-Hans">简体中文</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </main>
  );
}
export function SettingsView() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}

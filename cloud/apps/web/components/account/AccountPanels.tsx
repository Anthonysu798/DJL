"use client";
import type {
  CloudDeleteAccountResponse,
  CloudDeviceSession,
  CloudDeviceSessionsResponse,
} from "@synara/contracts/cloud";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  ArrowUpRight,
  CircleAlert,
  Copy,
  CreditCard,
  Laptop,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Credits, type Me } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { registerBrowserDevice } from "@/lib/browser-device";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { toast } from "@/components/chat/toast";

function PanelLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-52 w-full" />
    </div>
  );
}

export function AccountPanel() {
  const { d, locale } = useLocale();
  const scope = useRef<HTMLDivElement>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      const [user, balance] = await Promise.all([api<Me>("/v1/me"), api<Credits>("/v1/credits")]);
      setMe(user);
      setCredits(balance);
    } catch (e) {
      setError(e instanceof Error ? e.message : d.error);
    }
  }, [d.error]);
  useEffect(() => {
    void load();
  }, [load]);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        if (me)
          gsap.from(".account-panel-card", {
            y: 10,
            opacity: 0,
            stagger: 0.06,
            duration: 0.35,
            ease: "power2.out",
          });
      });
      return () => media.revert();
    },
    { scope, dependencies: [me?.user.id] },
  );
  const signOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
      window.location.assign("/sign-in");
    } catch (e) {
      setError(e instanceof Error ? e.message : d.error);
      setSigningOut(false);
    }
  };
  const number = (value: string | number) =>
    new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN", { maximumFractionDigits: 2 }).format(
      Number(value),
    );
  if (error && !me)
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>{d.error}</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            {d.chat.retry}
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!me || !credits) return <PanelLoading />;
  return (
    <div ref={scope} className="grid grid-flow-dense gap-6 lg:grid-cols-2">
      {error ? (
        <Alert variant="destructive" className="lg:col-span-2">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card className="account-panel-card">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
            <UserRound className="size-5" />
            {d.accountUi.details}
          </CardTitle>
          <CardDescription>{d.accountUi.detailsHint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-xl font-medium"
            >
              {me.user.email[0]?.toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{me.user.email}</p>
              <Badge variant="secondary" className="mt-2">
                {me.user.emailVerified ? (
                  <ShieldCheck data-icon="inline-start" />
                ) : (
                  <Mail data-icon="inline-start" />
                )}
                {me.user.emailVerified ? d.accountUi.verified : d.accountUi.notVerified}
              </Badge>
            </div>
          </div>
          <dl className="flex flex-col gap-4 text-sm">
            <div>
              <dt className="mb-1 text-muted-foreground">{d.accountUi.emailAddress}</dt>
              <dd className="break-all">{me.user.email}</dd>
            </div>
            <div>
              <dt className="mb-1 text-muted-foreground">{d.accountUi.accountId}</dt>
              <dd className="break-all font-mono text-xs">{me.user.id}</dd>
            </div>
          </dl>
        </CardContent>
        <CardFooter>
          <Button variant="outline" disabled={signingOut} onClick={() => void signOut()}>
            {signingOut ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <LogOut data-icon="inline-start" />
            )}
            {d.signOut}
          </Button>
        </CardFooter>
      </Card>
      <Card className="account-panel-card">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
            <CreditCard className="size-5" />
            {d.credits}
          </CardTitle>
          <CardDescription>{d.accountUi.creditsHint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p className="text-4xl font-medium tracking-tight">
            {number(credits.display.total)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {d.accountUi.available}
            </span>
          </p>
          <dl className="grid grid-cols-2 gap-5 text-sm">
            {[
              [d.chat.freePlan, number(Number(credits.balances.free ?? "0") / 1000000)],
              [d.trial, number(credits.display.trial)],
              [d.plan, number(credits.display.plan)],
              [d.topup, number(credits.display.topup)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="mb-1 text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
        <CardFooter>
          <Button variant="outline" asChild>
            <Link href="/billing">
              {d.manageBilling}
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
      <Card className="account-panel-card lg:col-span-2">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {d.accountUi.danger}
          </CardTitle>
          <CardDescription>{d.accountUi.dangerHint}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <Trash2 />
            <AlertTitle>{d.accountUi.deleteTitle}</AlertTitle>
            <AlertDescription>{d.accountUi.deleteBody}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/chat/settings?tab=devices"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            {d.accountUi.reviewDevices}
          </Link>
          <DeleteAccountDialog email={me.user.email} />
        </CardFooter>
      </Card>
    </div>
  );
}

function DeleteAccountDialog({ email }: { email: string }) {
  const { d } = useLocale();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = confirmation.trim() === email;
  const invalid = confirmation.length > 0 && !matches;
  const remove = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api<CloudDeleteAccountResponse>("/v1/me", { method: "DELETE" });
      await authClient.signOut().catch(() => {});
      window.location.assign("/sign-in");
    } catch (e) {
      setError(e instanceof Error ? e.message : d.error);
      setBusy(false);
    }
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next);
          if (next) {
            setConfirmation("");
            setError(null);
          }
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 data-icon="inline-start" />
          {d.accountUi.deleteTitle}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{d.accountUi.confirmDeleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{d.accountUi.deleteBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm leading-6 text-muted-foreground">
          {d.accountUi.billingWarning}{" "}
          <Link href="/billing" className="underline underline-offset-4">
            {d.manageBilling}
          </Link>
        </p>
        <FieldGroup>
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor="delete-email">{d.accountUi.confirmEmail}</FieldLabel>
            <Input
              id="delete-email"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={email}
              autoComplete="off"
              disabled={busy}
              aria-invalid={invalid}
              aria-describedby={invalid ? "delete-email-error" : "delete-email-hint"}
            />
            <FieldDescription id="delete-email-hint">
              {fill(d.accountUi.typeEmail, { email })}
            </FieldDescription>
            {invalid ? (
              <FieldError id="delete-email-error">{d.accountUi.emailMismatch}</FieldError>
            ) : null}
          </Field>
        </FieldGroup>
        {error ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{d.chat.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matches || busy}
            onClick={(event) => void remove(event)}
          >
            {busy ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            {busy ? d.accountUi.deleting : d.accountUi.deleteTitle}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function deviceLabel(login: CloudDeviceSession, unknown: string) {
  if (login.name && login.name !== "Web browser") return login.name;
  const ua = login.userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome|CriOS/.test(ua)
        ? "Chrome"
        : /Safari/.test(ua)
          ? "Safari"
          : null;
  const platform = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Macintosh|Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : login.platform;
  return [browser, platform].filter(Boolean).join(" · ") || unknown;
}

export function DevicesPanel() {
  const { d, locale } = useLocale();
  const { data } = authClient.useSession();
  const [sessions, setSessions] = useState<readonly CloudDeviceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      if (data?.session.id) await registerBrowserDevice(data.session.id);
      const response = await api<CloudDeviceSessionsResponse>("/v1/devices/sessions");
      setSessions(response.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : d.error);
    } finally {
      setRefreshing(false);
    }
  }, [data?.session.id, d.error]);
  useEffect(() => {
    if (data?.session.id) void load();
  }, [data?.session.id, load]);
  const date = (value: string) =>
    new Date(value).toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(d.devicesUi.copied);
    } catch {
      toast(d.error, "error");
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">{d.devicesUi.body}</p>
        <Button variant="outline" disabled={refreshing} onClick={() => void load()}>
          <RefreshCw data-icon="inline-start" className={refreshing ? "animate-spin" : undefined} />
          {d.devicesUi.refresh}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!sessions && !error ? (
        <PanelLoading />
      ) : sessions?.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Laptop />
            </EmptyMedia>
            <EmptyTitle>{d.devicesUi.empty}</EmptyTitle>
            <EmptyDescription>{d.devicesUi.emptyHint}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        sessions?.map((login) => (
          <Card key={login.id}>
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
                {login.kind === "ios" || /iPhone|iPad|Android/.test(login.userAgent ?? "") ? (
                  <Smartphone className="size-5" />
                ) : (
                  <Laptop className="size-5" />
                )}
                {deviceLabel(login, d.devicesUi.unknown)}
              </CardTitle>
              <CardDescription>{d.devicesUi.signedInSession}</CardDescription>
              {login.current ? (
                <CardAction>
                  <Badge>{d.devicesUi.current}</Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent>
              <dl className="grid gap-5 text-sm sm:grid-cols-3">
                <div>
                  <dt className="mb-1 text-muted-foreground">{d.devicesUi.ip}</dt>
                  <dd className="break-all font-mono text-xs">
                    {login.ipAddress ?? d.devicesUi.unavailable}
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 text-muted-foreground">{d.devicesUi.signedIn}</dt>
                  <dd>{date(login.createdAt)}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-muted-foreground">{d.devicesUi.lastSeen}</dt>
                  <dd>{date(login.lastSeenAt)}</dd>
                </div>
              </dl>
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-muted-foreground">{d.devicesUi.deviceId}</p>
                  <p className="break-all font-mono text-xs">
                    {login.deviceId ?? d.devicesUi.unlinked}
                  </p>
                </div>
                {login.deviceId ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={d.devicesUi.copyDevice}
                    onClick={() => void copy(login.deviceId!)}
                  >
                    <Copy />
                  </Button>
                ) : null}
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{d.devicesUi.sessionId}</p>
                <p className="break-all font-mono text-xs text-muted-foreground">{login.id}</p>
              </div>
            </CardFooter>
          </Card>
        ))
      )}
      <p className="text-xs leading-5 text-muted-foreground">{d.devicesUi.note}</p>
    </div>
  );
}

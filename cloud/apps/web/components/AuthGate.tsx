"use client";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/locale-context";

/** Renders children only with a session; otherwise sends the user to sign-in with a return path. */
export function AuthGate({ children, next }: { children: ReactNode; next: string }) {
  const { data, isPending } = authClient.useSession();
  const router = useRouter();
  const { d } = useLocale();
  useEffect(() => {
    if (!isPending && !data) router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
  }, [data, isPending, next, router]);
  if (isPending || !data) return <p className="text-sm text-neutral-500">{d.loading}</p>;
  return <>{children}</>;
}

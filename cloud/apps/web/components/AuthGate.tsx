"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/locale-context";

/** Renders children only with a session; otherwise sends the user to sign-in with a return path. */
export function AuthGate({ children, next }: { children: ReactNode; next: string }) {
  const { data, isPending, refetch } = authClient.useSession();
  const [checked, setChecked] = useState(Boolean(data));
  const router = useRouter();
  const { d } = useLocale();
  useEffect(() => {
    if (checked) return;
    let mounted = true;
    // A signed-out cache may predate verification on another page.
    void refetch().then(() => {
      if (mounted) setChecked(true);
    });
    return () => {
      mounted = false;
    };
  }, [checked, refetch]);
  useEffect(() => {
    if (checked && !isPending && !data) router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
  }, [checked, data, isPending, next, router]);
  if (!checked || isPending || !data)
    return <p className="text-sm text-neutral-500">{d.loading}</p>;
  return <>{children}</>;
}

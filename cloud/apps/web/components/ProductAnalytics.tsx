"use client";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  ANALYTICS_PREFERENCE_EVENT,
  attachWebAnalytics,
  createWebAnalytics,
  setWebAnalyticsEnabled,
  webAnalyticsEnabled,
} from "@/lib/productAnalytics";
import { useLocale } from "@/lib/locale-context";

export function ProductAnalyticsTracker() {
  const session = authClient.useSession();
  const scope = useRef("anonymous");
  const clientRef = useRef<ReturnType<typeof createWebAnalytics> | null>(null);
  const ready = useRef(!session.isPending);
  ready.current = !session.isPending;
  if (!session.isPending) scope.current = session.data?.user.id ?? "anonymous";
  useEffect(() => {
    const client = createWebAnalytics(() => scope.current);
    let current = true;
    clientRef.current = client;
    attachWebAnalytics(client);
    const visibility = () =>
      client.setForeground(ready.current && document.visibilityState === "visible");
    void client.start().then(() => {
      if (current) {
        visibility();
        window.dispatchEvent(new Event(ANALYTICS_PREFERENCE_EVENT));
      }
    });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      current = false;
      document.removeEventListener("visibilitychange", visibility);
      clientRef.current = null;
      attachWebAnalytics(null);
      client.close();
    };
  }, []);
  useEffect(() => {
    const client = clientRef.current;
    if (client && !session.isPending) {
      client.setForeground(document.visibilityState === "visible");
      void client.flush();
    }
  }, [session.isPending, session.data?.user.id]);
  return null;
}

export function ProductAnalyticsPreference() {
  const { d } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sync = () => setEnabled(webAnalyticsEnabled());
    sync();
    window.addEventListener(ANALYTICS_PREFERENCE_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, sync);
  }, []);
  return (
    <section className="card space-y-3">
      <label className="flex items-center justify-between gap-4 text-sm font-medium">
        {d.productAnalytics}
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => {
            setBusy(true);
            void setWebAnalyticsEnabled(event.target.checked)
              .then(setEnabled)
              .finally(() => setBusy(false));
          }}
        />
      </label>
      <p className="text-sm text-muted-foreground">{d.productAnalyticsDescription}</p>
    </section>
  );
}

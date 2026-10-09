"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthGate } from "@/components/AuthGate";
import { api, type Credits, type Me } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

interface Device {
  id: string;
  kind: string;
  name: string | null;
  trustState: string;
  syncEnabled: boolean;
  lastSeenAt: string | null;
}

function AccountView() {
  const { d } = useLocale();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<Me>("/v1/me"),
      api<Credits>("/v1/credits"),
      api<{ devices: Device[] }>("/v1/devices"),
    ])
      .then(([m, c, dv]) => {
        setMe(m);
        setCredits(c);
        setDevices(dv.devices);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const signOut = async () => {
    await authClient.signOut();
    router.replace("/sign-in");
  };

  if (error)
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  if (!me || !credits) return <p className="text-sm text-neutral-500">{d.loading}</p>;

  return (
    <div className="space-y-6">
      <div className="card space-y-2">
        <h1 className="text-xl font-semibold">{d.account}</h1>
        <p className="text-sm text-neutral-600">{me.user.email}</p>
      </div>
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">{d.credits}</h2>
        <p className="text-2xl font-semibold">
          {fill(d.creditsAvailable, { credits: credits.display.total })}
        </p>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-neutral-500">{d.trial}</dt>
            <dd>{credits.display.trial}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">{d.plan}</dt>
            <dd>{credits.display.plan}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">{d.topup}</dt>
            <dd>{credits.display.topup}</dd>
          </div>
        </dl>
        <Link className="btn" href="/billing">
          {d.buyCredits}
        </Link>
      </div>
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">{d.devices}</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-neutral-500">{d.noDevices}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {devices.map((device) => (
              <li key={device.id} className="flex justify-between">
                <span>{device.name ?? device.kind}</span>
                <span className="text-neutral-500">
                  {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="btn-secondary" type="button" onClick={() => void signOut()}>
        {d.signOut}
      </button>
    </div>
  );
}

export default function AccountPage() {
  return (
    <AuthGate next="/account">
      <AccountView />
    </AuthGate>
  );
}

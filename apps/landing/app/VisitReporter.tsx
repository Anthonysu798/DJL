"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export async function reportPathname(
  pathname: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl("/api/visits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    });
  } catch {
    // Traffic reporting must never affect navigation.
  }
}

export function VisitReporter() {
  const pathname = usePathname();

  useEffect(() => {
    void reportPathname(pathname);
  }, [pathname]);

  return null;
}

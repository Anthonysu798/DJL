"use client";
import { useEffect, useState } from "react";

import type { ChatClient } from "@/lib/chat/client";
import { useChatClient } from "@/lib/chat/context";

const cache = new Map<string, { url: string; expiresAt: number }>();
const pending = new Map<string, Promise<string>>();

/** A signed download URL for a file, reused until shortly before it expires (they last five minutes). */
export function signedFileUrl(client: ChatClient, fileId: string): Promise<string> {
  const hit = cache.get(fileId);
  if (hit && hit.expiresAt - Date.now() > 30_000) return Promise.resolve(hit.url);
  let p = pending.get(fileId);
  if (!p) {
    p = client
      .fileUrl(fileId)
      .then(({ url, expiresAt }) => {
        cache.set(fileId, { url, expiresAt: Date.parse(expiresAt) });
        return url;
      })
      .finally(() => pending.delete(fileId));
    pending.set(fileId, p);
  }
  return p;
}

export function useFileUrl(fileId: string): { url: string | null; failed: boolean } {
  const client = useChatClient();
  const [state, setState] = useState<{ url: string | null; failed: boolean }>(() => {
    const hit = cache.get(fileId);
    return { url: hit && hit.expiresAt > Date.now() ? hit.url : null, failed: false };
  });
  useEffect(() => {
    let live = true;
    signedFileUrl(client, fileId).then(
      (url) => live && setState({ url, failed: false }),
      () => live && setState({ url: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [client, fileId]);
  return state;
}

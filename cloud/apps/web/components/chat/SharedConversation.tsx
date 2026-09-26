"use client";
/* oxlint-disable react/no-array-index-key -- a snapshot's messages and parts are fixed and carry no ids */
import type { CloudImageRefPart, CloudPublicShareResponse } from "@synara/contracts/cloud";
import { FileText, ImageOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { chatClient } from "@/lib/chat/api";
import { formatDate } from "@/lib/chat/format";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

import { Markdown } from "./Markdown";
import { TaskSteps } from "./TaskSteps";

/** A shared image through the share's own short-lived signed URL; a placeholder once it's gone. */
function SharedImage({ part, url }: { part: CloudImageRefPart; url: string | undefined }) {
  const { d } = useLocale();
  const [failed, setFailed] = useState(false);
  if (!url || failed)
    return (
      <span className="inline-flex w-fit items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        <ImageOff className="size-4" aria-hidden />
        {d.chat.imageUnavailable}
      </span>
    );
  return (
    // Signed storage URLs can't go through next/image's optimizer.
    <img
      src={url}
      alt={d.chat.image}
      onError={() => setFailed(true)}
      className="w-full max-w-sm rounded-xl border border-border bg-muted object-cover"
      style={{
        aspectRatio: part.width && part.height ? `${part.width} / ${part.height}` : undefined,
      }}
    />
  );
}

/** Read-only view of a shared snapshot. No account needed; nothing here can change the chat. */
export function SharedConversation({ token }: { token: string }) {
  const { d, locale } = useLocale();
  const [share, setShare] = useState<CloudPublicShareResponse | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    chatClient.getPublicShare(token).then(setShare, () => setMissing(true));
  }, [token]);

  return (
    <div className="min-h-dvh bg-card">
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/chat" className="text-[15px] font-semibold tracking-tight">
            DJL
          </Link>
          <Button asChild size="sm">
            <Link href="/chat">{d.chat.startOwnChat}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {missing ? (
          <p className="py-20 text-center text-muted-foreground">{d.chat.shareMissing}</p>
        ) : !share ? (
          <p className="py-20 text-center text-muted-foreground" role="status">
            {d.loading}
          </p>
        ) : (
          <>
            <div className="mb-8 border-b border-border pb-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                {share.title || d.chat.untitled}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {fill(d.chat.sharedSnapshot, { date: formatDate(share.createdAt, locale) })} ·{" "}
                {d.chat.readOnly}
              </p>
            </div>
            <div className="flex flex-col gap-8">
              {share.messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex flex-col items-end gap-2">
                    {m.parts.map((p, j) =>
                      p.type === "text" ? (
                        <div
                          key={j}
                          className="max-w-[85%] rounded-3xl bg-secondary px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]"
                        >
                          {p.text}
                        </div>
                      ) : p.type === "file_ref" ? (
                        <span
                          key={j}
                          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"
                        >
                          <FileText className="size-4 text-primary" aria-hidden />
                          {p.name}
                        </span>
                      ) : p.type === "image_ref" ? (
                        <SharedImage key={j} part={p} url={share.imageUrls[p.fileId]} />
                      ) : null,
                    )}
                  </div>
                ) : (
                  <div key={i} className="flex flex-col gap-3">
                    <TaskSteps parts={m.parts} run={undefined} />
                    {m.parts.map((p, j) =>
                      p.type === "text" ? (
                        <Markdown key={j} text={p.text} />
                      ) : p.type === "image_ref" ? (
                        <SharedImage key={j} part={p} url={share.imageUrls[p.fileId]} />
                      ) : null,
                    )}
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

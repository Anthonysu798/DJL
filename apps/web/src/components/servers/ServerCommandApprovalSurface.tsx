// FILE: ServerCommandApprovalSurface.tsx
// Purpose: Global bottom-right stack of agent commands waiting for the user's approval.
// Layer: UI components (servers)
// Exports: ServerCommandApprovalSurface

import type {
  ServerCommandDecision,
  ServerCommandRecord,
  ServerCommandStreamEvent,
  ThreadId,
} from "@synara/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { COMPACT_NOTIFICATION_SURFACE_CLASS_NAME } from "~/components/ui/notificationSurface";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";

const MAX_VISIBLE_CARDS = 3;

export function applyServerCommandEvent(
  pending: readonly ServerCommandRecord[],
  event: ServerCommandStreamEvent,
): ServerCommandRecord[] {
  if (event.type === "snapshot") {
    return event.pending.filter((command) => command.status === "pending");
  }
  const others = pending.filter((command) => command.id !== event.command.id);
  return event.command.status === "pending" ? [...others, event.command] : others;
}

async function notifyDesktop(title: string, body: string): Promise<void> {
  try {
    const bridge = window.desktopBridge?.notifications;
    if (!bridge || !(await bridge.isSupported())) return;
    await bridge.show({ title, body, silent: false });
  } catch {
    // The in-app card is the source of truth; a missing OS notification is not an error.
  }
}

function ThreadLine({ threadId }: { threadId: ThreadId }) {
  const { t } = useTranslation("settings");
  const title = useStore((state) => state.threadShellById?.[threadId]?.title);
  if (!title) return null;
  return (
    <p className="truncate text-[11px] text-[var(--notification-fg)]/70">
      {t("servers.approval.thread", { thread: title })}
    </p>
  );
}

function ApprovalCard({
  command,
  busy,
  onResolve,
}: {
  command: ServerCommandRecord;
  busy: boolean;
  onResolve: (decision: ServerCommandDecision) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <div
      className={cn(
        COMPACT_NOTIFICATION_SURFACE_CLASS_NAME,
        "servers-row-enter w-[min(calc(100vw-2rem),24rem)] p-3.5",
      )}
      role="group"
      aria-label={t("servers.approval.title", { server: command.serverName })}
      data-command-id={command.id}
    >
      <div className="flex items-start gap-2.5">
        <CentralIcon name="server" className="mt-0.5 size-4 shrink-0 opacity-80" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium">
            {t("servers.approval.title", { server: command.serverName })}
          </p>
          {command.threadId ? <ThreadLine threadId={command.threadId as ThreadId} /> : null}
        </div>
      </div>
      <pre className="mt-2.5 max-h-24 overflow-y-auto rounded-md bg-[var(--color-background-elevated-secondary)] px-2.5 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-[var(--color-text-foreground)]">
        {command.command}
      </pre>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-[10.5px] text-[var(--notification-fg)]/55">
          {t("servers.approval.waits")}
        </span>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="servers-press"
            disabled={busy}
            onClick={() => onResolve("deny")}
          >
            {t("servers.approval.deny")}
          </Button>
          <Button
            size="sm"
            className="servers-press"
            disabled={busy}
            onClick={() => onResolve("approve")}
          >
            {t("servers.approval.approve")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ServerCommandApprovalSurface() {
  const { t } = useTranslation("settings");
  const [pending, setPending] = useState<ServerCommandRecord[]>([]);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef<ServerCommandRecord[]>([]);
  const notifiedIds = useRef(new Set<string>());

  useEffect(() => {
    return ensureNativeApi().servers.onEvent((event) => {
      const next = applyServerCommandEvent(pendingRef.current, event);
      pendingRef.current = next;
      setPending(next);
      for (const command of next) {
        if (notifiedIds.current.has(command.id)) continue;
        notifiedIds.current.add(command.id);
        void notifyDesktop(
          t("servers.approval.title", { server: command.serverName }),
          command.command,
        );
      }
    });
  }, [t]);

  const resolve = useCallback((id: ServerCommandRecord["id"], decision: ServerCommandDecision) => {
    setBusyIds((current) => new Set(current).add(id));
    ensureNativeApi()
      .servers.resolveCommand({ id, decision })
      .catch(() => {
        // Leave the card in place so the user can try again.
      })
      .finally(() => {
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      });
  }, []);

  if (pending.length === 0) return null;

  const newestFirst = pending.toSorted((a, b) => b.requestedAt - a.requestedAt);
  const visible = newestFirst.slice(0, MAX_VISIBLE_CARDS);
  const hidden = newestFirst.length - visible.length;

  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2"
      role="region"
      aria-label={t("servers.approval.region")}
      aria-live="polite"
    >
      {visible.map((command) => (
        <ApprovalCard
          key={command.id}
          command={command}
          busy={busyIds.has(command.id)}
          onResolve={(decision) => resolve(command.id, decision)}
        />
      ))}
      {hidden > 0 ? (
        <p className="pr-1 text-[10.5px] text-muted-foreground">
          {t("servers.approval.more", { count: hidden })}
        </p>
      ) : null}
    </div>
  );
}

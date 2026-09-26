"use client";
import type { CloudConversation, CloudPlanId } from "@synara/contracts/cloud";
import {
  Archive,
  ArchiveRestore,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useTheme } from "@/components/theme";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MOCK_API } from "@/lib/chat/api";
import { useChat, useChatStore } from "@/lib/chat/context";
import { groupConversations } from "@/lib/chat/grouping";
import { fill, type Dict } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

import { DeleteDialog, RenameDialog } from "./ConversationDialogs";
import { toast } from "./toast";
import { UsageMeter } from "./Usage";

const planName = (d: Dict, plan: CloudPlanId) =>
  plan === "free" ? d.chat.freePlan : plan === "trial" ? d.trial : d.tiers[plan];

export function Sidebar({
  activeId,
  onSearch,
  onNavigate,
  onCollapse,
}: {
  activeId: string | null;
  onSearch: () => void;
  onNavigate: () => void;
  onCollapse?: (() => void) | undefined;
}) {
  const { d } = useLocale();
  const router = useRouter();
  const store = useChatStore();
  const conversations = useChat((s) => s.conversations);
  const listStatus = useChat((s) => s.listStatus);
  const groups = useMemo(() => groupConversations(conversations, new Date()), [conversations]);
  const [renaming, setRenaming] = useState<CloudConversation | null>(null);
  const [deleting, setDeleting] = useState<CloudConversation | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const leaveIfActive = (id: string) => {
    if (id === activeId) router.push("/chat");
  };
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      toast(d.error, "error");
    }
  };

  const sections: Array<[string, readonly CloudConversation[]]> = [
    [d.chat.pinned, groups.pinned],
    [d.chat.today, groups.today],
    [d.chat.previous7Days, groups.previous7Days],
    [d.chat.older, groups.older],
  ];

  return (
    <nav aria-label={d.chat.sidebarLabel} className="flex h-full flex-col bg-sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <Link
          href="/chat"
          onClick={onNavigate}
          className="rounded-md px-2 py-1 text-[15px] font-semibold tracking-tight focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          DJL
        </Link>
        {onCollapse ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onCollapse}
            aria-label={d.chat.closeSidebar}
            className="text-muted-foreground"
          >
            <PanelLeftClose />
          </Button>
        ) : null}
      </div>
      <div className="space-y-0.5 px-2">
        <Link
          href="/chat"
          onClick={onNavigate}
          className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <SquarePen className="size-4" aria-hidden />
          {d.chat.newChat}
        </Link>
        <button
          type="button"
          onClick={onSearch}
          className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <Search className="size-4" aria-hidden />
          {d.chat.searchChats}
          <kbd className="ml-auto font-sans text-xs text-muted-foreground max-md:hidden">⌘K</kbd>
        </button>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {listStatus === "error" ? (
          <div className="px-2.5 py-2 text-sm text-muted-foreground">
            <p>{d.chat.loadFailed}</p>
            <Button variant="link" className="h-auto p-0" onClick={() => void store.init()}>
              {d.chat.retry}
            </Button>
          </div>
        ) : listStatus === "ready" && conversations.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">{d.chat.noChats}</p>
        ) : listStatus !== "ready" ? (
          <div className="space-y-2 px-2.5 py-2" aria-hidden>
            {[70, 55, 80, 60].map((w) => (
              <div
                key={w}
                className="h-4 animate-pulse rounded bg-muted"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        ) : (
          sections.map(([label, list]) =>
            list.length === 0 ? null : (
              <section key={label} className="mb-4" aria-label={label}>
                <h2 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{label}</h2>
                <ul className="space-y-px">
                  {list.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conversation={c}
                      active={c.id === activeId}
                      onNavigate={onNavigate}
                      onRename={() => setRenaming(c)}
                      onPin={() => void act(() => store.setPinned(c.id, !c.pinned))}
                      onArchive={() =>
                        void act(async () => {
                          await store.setArchived(c.id, true);
                          leaveIfActive(c.id);
                        })
                      }
                      onDelete={() => setDeleting(c)}
                    />
                  ))}
                </ul>
              </section>
            ),
          )
        )}
      </div>

      <div className="border-t border-border p-2">
        <AccountMenu onArchived={() => setArchivedOpen(true)} />
      </div>

      <RenameDialog
        conversation={renaming}
        onClose={() => setRenaming(null)}
        onRename={(title) => store.rename(renaming!.id, title)}
      />
      <DeleteDialog
        conversation={deleting}
        onClose={() => setDeleting(null)}
        onDelete={async () => {
          const id = deleting!.id;
          await store.remove(id);
          leaveIfActive(id);
        }}
      />
      <ArchivedDialog open={archivedOpen} onOpenChange={setArchivedOpen} onNavigate={onNavigate} />
    </nav>
  );
}

function ConversationRow({
  conversation: c,
  active,
  onNavigate,
  onRename,
  onPin,
  onArchive,
  onDelete,
}: {
  conversation: CloudConversation;
  active: boolean;
  onNavigate: () => void;
  onRename: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { d } = useLocale();
  const title = c.title || d.chat.untitled;
  return (
    <li
      className={cn(
        "group relative flex items-center rounded-lg",
        active ? "bg-accent" : "hover:bg-accent/70",
      )}
    >
      <Link
        href={`/chat/${encodeURIComponent(c.id)}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="truncate">{title}</span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={fill(d.chat.chatOptions, { title })}
            className={cn(
              "mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none data-[state=open]:opacity-100",
              active
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil /> {d.chat.rename}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onPin}>
            {c.pinned ? <PinOff /> : <Pin />} {c.pinned ? d.chat.unpin : d.chat.pin}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            <Archive /> {d.chat.archive}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> {d.chat.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function AccountMenu({ onArchived }: { onArchived: () => void }) {
  const { d } = useLocale();
  const router = useRouter();
  const me = useChat((s) => s.me);
  const usage = useChat((s) => s.usage);
  const { theme, setTheme } = useTheme();
  const email = me?.user.email ?? "";

  const signOut = async () => {
    if (!MOCK_API) {
      const { authClient } = await import("@/lib/auth-client");
      await authClient.signOut();
    }
    router.replace("/sign-in");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={d.chat.accountMenu}
          className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-accent"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
            aria-hidden
          >
            {(email[0] ?? "?").toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{email || d.loading}</span>
            {usage ? (
              <span className="block text-xs text-muted-foreground">
                {planName(d, usage.planId)}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 p-1.5"
      >
        {usage ? (
          <div className="px-2 pt-1.5 pb-3">
            <p className="mb-2.5 text-xs font-medium text-muted-foreground">{d.chat.usage}</p>
            <UsageMeter usage={usage} />
          </div>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onArchived}>
          <ArchiveRestore /> {d.chat.archivedChats}
        </DropdownMenuItem>
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={theme === "dark"}
          onSelect={(e) => {
            e.preventDefault();
            setTheme(theme === "dark" ? "light" : "dark");
          }}
        >
          <Moon /> {d.chat.darkMode}
          <span
            aria-hidden
            className={cn(
              "ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
              theme === "dark" ? "justify-end bg-primary" : "justify-start bg-input",
            )}
          >
            <span className="size-3 rounded-full bg-white shadow-sm" />
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound /> {d.chat.accountSettings}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/billing">
            <CreditCard /> {d.chat.upgrade}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> {d.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ArchivedDialog({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onNavigate: () => void;
}) {
  const { d } = useLocale();
  const store = useChatStore();
  const archived = useChat((s) => s.archived);
  const [deleting, setDeleting] = useState<CloudConversation | null>(null);

  useEffect(() => {
    if (open) void store.loadArchived().catch(() => toast(d.error, "error"));
  }, [open, store, d]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{d.chat.archivedChats}</DialogTitle>
            <DialogDescription className="sr-only">{d.chat.archivedChats}</DialogDescription>
          </DialogHeader>
          {archived === null ? (
            <p className="text-sm text-muted-foreground">{d.loading}</p>
          ) : archived.length === 0 ? (
            <p className="text-sm text-muted-foreground">{d.chat.noArchived}</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {archived.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                  <Link
                    href={`/chat/${encodeURIComponent(c.id)}`}
                    onClick={() => {
                      onOpenChange(false);
                      onNavigate();
                    }}
                    className="min-w-0 flex-1 truncate text-sm hover:underline"
                  >
                    {c.title || d.chat.untitled}
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void store.setArchived(c.id, false).catch(() => toast(d.error, "error"))
                    }
                  >
                    <ArchiveRestore /> {d.chat.restore}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${d.chat.delete}: ${c.title || d.chat.untitled}`}
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <DeleteDialog
        conversation={deleting}
        onClose={() => setDeleting(null)}
        onDelete={() => store.remove(deleting!.id)}
      />
    </>
  );
}

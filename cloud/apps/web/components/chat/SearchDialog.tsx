"use client";
import type { CloudConversationSearchHit } from "@synara/contracts/cloud";
import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useChat, useChatClient } from "@/lib/chat/context";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-primary/15 text-foreground">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { d } = useLocale();
  const client = useChatClient();
  const router = useRouter();
  const recent = useChat((s) => s.conversations);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly CloudConversationSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      client.searchConversations(q.slice(0, 200), controller.signal).then(
        (r) => {
          setResults(r.results);
          setLoading(false);
        },
        () => !controller.signal.aborted && setLoading(false),
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, client]);

  const go = (id: string) => {
    onOpenChange(false);
    router.push(`/chat/${encodeURIComponent(id)}`);
  };
  const q = query.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[20%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{d.chat.searchChats}</DialogTitle>
        <DialogDescription className="sr-only">{d.chat.searchHint}</DialogDescription>
        <Command
          shouldFilter={false}
          loop
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={d.chat.searchPlaceholder}
            className="h-12 text-[15px]"
          />
          <CommandList className="max-h-[min(24rem,60vh)] p-1.5">
            {q && loading && !results ? (
              <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                {d.chat.searching}
              </p>
            ) : null}
            {q && results ? <CommandEmpty>{fill(d.chat.noResults, { q })}</CommandEmpty> : null}
            {q && results
              ? results.map((hit) => (
                  <CommandItem
                    key={`${hit.conversation.id}:${hit.messageId ?? ""}`}
                    value={`${hit.conversation.id}:${hit.messageId ?? ""}`}
                    onSelect={() => go(hit.conversation.id)}
                    className="items-start gap-3 rounded-lg px-2.5 py-2.5"
                  >
                    <MessageSquare className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {hit.conversation.title || d.chat.untitled}
                      </p>
                      {hit.snippet ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          <Highlight text={hit.snippet} query={q} />
                        </p>
                      ) : null}
                    </div>
                  </CommandItem>
                ))
              : null}
            {!q ? (
              <CommandGroup heading={d.chat.recent}>
                {recent.slice(0, 8).map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => go(c.id)}
                    className="gap-3 rounded-lg px-2.5 py-2"
                  >
                    <MessageSquare />
                    <span className="truncate">{c.title || d.chat.untitled}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

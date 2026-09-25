"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { NAV_MAIN, NAV_PLATFORM } from "@/components/Shell";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { admin } from "@/lib/api";

interface UserRow {
  id: string;
  email: string;
  name: string;
}

/** ⌘K: jump to a page or straight to a user by email, name, or id. */
export function CommandPalette({
  open,
  onOpenChange,
  isAdmin = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setUsers([]);
      return;
    }
    const handle = setTimeout(() => {
      admin<{ users: UserRow[] }>(`/users?q=${encodeURIComponent(query.trim())}&limit=6`)
        .then((r) => setUsers(r.users))
        .catch(() => setUsers([]));
    }, 150);
    return () => clearTimeout(handle);
  }, [open, query]);
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Jump to a page or find a user"
    >
      <CommandInput placeholder="Search pages and users…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {users.length ? (
          <CommandGroup heading="Users">
            {users.map((u) => (
              <CommandItem
                key={u.id}
                value={`${u.email} ${u.name} ${u.id}`}
                onSelect={() => go(`/users/${u.id}`)}
              >
                <span className="font-medium">{u.name || u.email}</span>
                <span className="ml-2 text-muted-foreground">{u.email}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Pages">
          {[...NAV_MAIN, ...(isAdmin ? NAV_PLATFORM : [])].map(({ href, label, icon: Icon }) => (
            <CommandItem key={href} value={label} onSelect={() => go(href)}>
              <Icon className="size-4" />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

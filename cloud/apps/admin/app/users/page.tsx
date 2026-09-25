"use client";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Initials, PageCard, StatusPill, headRowClass, rowClass } from "@/components/PageCard";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface UserRow {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  phoneNumber: string | null;
  banned: boolean;
  banReason: string | null;
  createdAt: string;
}
const PAGE = 25;

function UsersView() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(params.get("q") ?? "");
  // Cursor pagination: the stack holds the cursor of every page visited so "previous" is exact.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const users = useLoad(
    () =>
      admin<{ users: UserRow[]; nextCursor: string | null }>(
        `/users?q=${encodeURIComponent(query)}&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    [query, cursor],
  );
  const page = cursors.length;
  return (
    <Shell
      title="Users"
      subtitle="Every account on DJL Cloud. Search by email, name, phone, or id."
    >
      <PageCard
        title="All users"
        action={
          <form
            noValidate
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setCursors([null]);
              setQuery(q);
            }}
          >
            <Input
              className="h-10 w-72 rounded-xl"
              placeholder="Search users…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button type="submit" className="h-10 rounded-xl">
              Search
            </Button>
          </form>
        }
      >
        {users.error ? (
          <p role="alert" className="text-sm text-destructive">
            {users.error}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className={headRowClass}>
              <TableHead className="w-10">
                <span className="sr-only">Row</span>
              </TableHead>
              <TableHead>User</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.users.map((u, i) => (
              <TableRow key={u.id} className={`${rowClass} h-16`}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {(page - 1) * PAGE + i + 1}
                </TableCell>
                <TableCell>
                  <Link href={`/users/${u.id}`} className="flex items-center gap-3">
                    <Initials name={u.name || u.email} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{u.name || "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.email}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.phoneNumber ?? "—"}</TableCell>
                <TableCell>
                  {u.banned ? (
                    <StatusPill tone="danger">Suspended</StatusPill>
                  ) : u.emailVerified ? (
                    <StatusPill tone="success">Active</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Unverified</StatusPill>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground"
                        aria-label={`Actions for ${u.email}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => router.push(`/users/${u.id}`)}>
                        Open profile
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          navigator.clipboard.writeText(u.email).catch(() => undefined)
                        }
                      >
                        Copy email
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => navigator.clipboard.writeText(u.id).catch(() => undefined)}
                      >
                        Copy user id
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {users.data && users.data.users.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No users match.</p>
        ) : null}
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-9 rounded-lg"
              aria-label="Previous page"
              disabled={cursors.length <= 1}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-9 rounded-lg"
              aria-label="Next page"
              disabled={!users.data?.nextCursor}
              onClick={() => setCursors((c) => [...c, users.data?.nextCursor ?? null])}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </PageCard>
    </Shell>
  );
}

export default function UsersPage() {
  return (
    <Suspense>
      <UsersView />
    </Suspense>
  );
}

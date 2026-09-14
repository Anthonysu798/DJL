"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function UsersView() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const users = useLoad(
    () =>
      admin<{ users: UserRow[]; nextCursor: string | null }>(
        `/users?q=${encodeURIComponent(query)}&limit=50`,
      ),
    [query],
  );
  return (
    <Shell
      title="Users"
      subtitle="Every account on DJL Cloud. Search by email, name, phone, or id."
    >
      <PageCard
        action={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q);
            }}
          >
            <Input
              className="pill h-9 w-72"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button type="submit" size="sm" className="rounded-full">
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
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.users.map((u) => (
              <TableRow key={u.id} className={rowClass}>
                <TableCell>
                  <Link href={`/users/${u.id}`} className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-primary/80 to-fuchsia-500/80 text-xs font-semibold text-white">
                      {(u.name || u.email).slice(0, 1).toUpperCase()}
                    </span>
                    <span className="font-medium">{u.name || "—"}</span>
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell className="text-muted-foreground">{u.phoneNumber ?? "—"}</TableCell>
                <TableCell>
                  {u.banned ? (
                    <Badge variant="destructive">Suspended</Badge>
                  ) : u.emailVerified ? (
                    <Badge className="bg-primary/20 text-foreground">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Unverified</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {users.data && users.data.users.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No users match.</p>
        ) : null}
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

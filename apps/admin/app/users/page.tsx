"use client";
import Link from "next/link";
import { useState } from "react";

import { Shell } from "@/components/Shell";
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

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const users = useLoad(
    () =>
      admin<{ users: UserRow[]; nextCursor: string | null }>(
        `/users?q=${encodeURIComponent(query)}&limit=50`,
      ),
    [query],
  );
  return (
    <Shell>
      <h1 className="mb-4 text-lg font-semibold">Users</h1>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <input
          className="input max-w-md"
          placeholder="Email, name, phone, or id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn" type="submit">
          Search
        </button>
      </form>
      {users.error ? (
        <p role="alert" className="text-sm text-red-600">
          {users.error}
        </p>
      ) : null}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Verified</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link className="underline" href={`/users/${u.id}`}>
                    {u.email}
                  </Link>
                </td>
                <td>{u.name}</td>
                <td>{u.emailVerified ? "yes" : "no"}</td>
                <td>{u.phoneNumber ?? "—"}</td>
                <td>{u.banned ? `suspended (${u.banReason ?? ""})` : "active"}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.data && users.data.users.length === 0 ? (
          <p className="p-2 text-sm text-neutral-500">No users match.</p>
        ) : null}
      </div>
    </Shell>
  );
}

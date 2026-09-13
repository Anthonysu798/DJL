"use client";
import { useState } from "react";

import { Shell } from "@/components/Shell";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Audit {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [filter, setFilter] = useState({ action: "", targetId: "", actorId: "" });
  const [applied, setApplied] = useState(filter);
  const audit = useLoad(
    () =>
      admin<Audit[]>(
        `/audit?limit=100${applied.action ? `&action=${encodeURIComponent(applied.action)}` : ""}${applied.targetId ? `&targetId=${encodeURIComponent(applied.targetId)}` : ""}${applied.actorId ? `&actorId=${encodeURIComponent(applied.actorId)}` : ""}`,
      ),
    [applied],
  );
  return (
    <Shell>
      <h1 className="mb-4 text-lg font-semibold">Audit log</h1>
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filter);
        }}
      >
        <input
          className="input max-w-48"
          placeholder="action prefix"
          value={filter.action}
          onChange={(e) => setFilter({ ...filter, action: e.target.value })}
        />
        <input
          className="input max-w-72"
          placeholder="target id"
          value={filter.targetId}
          onChange={(e) => setFilter({ ...filter, targetId: e.target.value })}
        />
        <input
          className="input max-w-72"
          placeholder="actor id"
          value={filter.actorId}
          onChange={(e) => setFilter({ ...filter, actorId: e.target.value })}
        />
        <button className="btn" type="submit">
          Filter
        </button>
      </form>
      {audit.error ? (
        <p role="alert" className="text-sm text-red-600">
          {audit.error}
        </p>
      ) : null}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Reason</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {audit.data?.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</td>
                <td className="text-xs">
                  {a.actorType}:{a.actorId.slice(0, 12)}
                </td>
                <td>{a.action}</td>
                <td className="text-xs">
                  {a.targetType}:{a.targetId.slice(0, 12)}
                </td>
                <td>{a.reason ?? ""}</td>
                <td className="max-w-md break-all text-xs">
                  {a.before !== null ? `before ${JSON.stringify(a.before)} ` : ""}
                  {a.after !== null ? `after ${JSON.stringify(a.after)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

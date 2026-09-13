"use client";
import { Shell } from "@/components/Shell";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Trial {
  id: string;
  orgId: string;
  userId: string;
  phoneLineType: string;
  status: string;
  reasons: string[];
  createdAt: string;
}

export default function TrialsPage() {
  const trials = useLoad(() => admin<Trial[]>("/trials"), []);
  return (
    <Shell>
      <h1 className="mb-4 text-lg font-semibold">Trial review queue</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Claims that hit the daily trial budget wait here. Approving grants the credits immediately
        and is audited.
      </p>
      {trials.error ? (
        <p role="alert" className="text-sm text-red-600">
          {trials.error}
        </p>
      ) : null}
      <div className="card">
        {trials.data?.length === 0 ? (
          <p className="text-sm text-neutral-500">Queue is empty.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Claimed</th>
                <th>User</th>
                <th>Line</th>
                <th>Reasons</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trials.data?.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleString()}</td>
                  <td>{t.userId}</td>
                  <td>{t.phoneLineType}</td>
                  <td>{t.reasons.join(", ")}</td>
                  <td>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        admin(`/trials/${t.id}/approve`, { method: "POST", json: {} }).then(
                          trials.reload,
                        )
                      }
                    >
                      Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}

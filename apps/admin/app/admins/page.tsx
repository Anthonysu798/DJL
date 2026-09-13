"use client";
import { Shell } from "@/components/Shell";
import { admin } from "@/lib/api";
import { askReason, useLoad } from "@/lib/useLoad";

interface Admin {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function AdminsPage() {
  const admins = useLoad(() => admin<Admin[]>("/admins"), []);
  const toggle = async (a: Admin) => {
    const reason = askReason(`${a.disabled ? "Enable" : "Disable"} ${a.email}`);
    if (!reason) return;
    await admin(`/admins/${a.id}/disabled`, {
      method: "POST",
      json: { disabled: !a.disabled, reason },
    });
    admins.reload();
  };
  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold">Admins</h1>
      <p className="mb-4 text-sm text-neutral-500">
        New admins are created from a trusted shell with `bun run admin:create` so no password ever
        crosses this UI.
      </p>
      {admins.error ? (
        <p role="alert" className="text-sm text-red-600">
          {admins.error}
        </p>
      ) : null}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>2FA</th>
              <th>Last login</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {admins.data?.map((a) => (
              <tr key={a.id}>
                <td>{a.email}</td>
                <td>{a.name}</td>
                <td>{a.role}</td>
                <td>{a.totpEnabled ? "on" : "not enrolled"}</td>
                <td>{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "never"}</td>
                <td>{a.disabled ? "disabled" : "active"}</td>
                <td>
                  <button
                    className={a.disabled ? "btn-secondary" : "btn-danger"}
                    type="button"
                    onClick={() => toggle(a)}
                  >
                    {a.disabled ? "Enable" : "Disable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

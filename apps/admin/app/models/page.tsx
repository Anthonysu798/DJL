"use client";
import { Shell } from "@/components/Shell";
import { admin } from "@/lib/api";
import { askReason, useLoad } from "@/lib/useLoad";

interface Model {
  modelId: string;
  provider: string;
  displayName: string;
  status: string;
  qualityScore: number;
  inputMicroPerToken: string;
  outputMicroPerToken: string;
  microPerImage: string;
  sortOrder: number;
  capabilities: string[];
}

export default function ModelsPage() {
  const models = useLoad(() => admin<Model[]>("/models"), []);
  const patch = async (m: Model, field: keyof Model, prompt: string) => {
    const value = window.prompt(prompt, String(m[field]));
    if (value === null) return;
    const reason = askReason(`Update ${field} of ${m.modelId}`);
    if (!reason) return;
    await admin(`/models/${m.modelId}`, {
      method: "PATCH",
      json: {
        [field]: field === "status" ? value : Number.isNaN(Number(value)) ? value : Number(value),
        reason,
      },
    });
    models.reload();
  };
  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold">Model catalog</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Prices are microcredits per token or per image (1 credit = 1,000,000 microcredits). Edits
        take effect within 30 seconds and are audited.
      </p>
      {models.error ? (
        <p role="alert" className="text-sm text-red-600">
          {models.error}
        </p>
      ) : null}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Quality</th>
              <th>Input µcr/tok</th>
              <th>Output µcr/tok</th>
              <th>µcr/image</th>
              <th>Caps</th>
            </tr>
          </thead>
          <tbody>
            {models.data?.map((m) => (
              <tr key={m.modelId}>
                <td>
                  {m.displayName}
                  <br />
                  <span className="text-xs text-neutral-500">{m.modelId}</span>
                </td>
                <td>{m.provider}</td>
                <td>
                  <button
                    className="underline"
                    type="button"
                    onClick={() => patch(m, "status", "active | degraded | disabled")}
                  >
                    {m.status}
                  </button>
                </td>
                <td>
                  <button
                    className="underline"
                    type="button"
                    onClick={() => patch(m, "qualityScore", "Quality 0-100")}
                  >
                    {m.qualityScore}
                  </button>
                </td>
                <td>
                  <button
                    className="underline tabular-nums"
                    type="button"
                    onClick={() => patch(m, "inputMicroPerToken", "Input microcredits per token")}
                  >
                    {m.inputMicroPerToken}
                  </button>
                </td>
                <td>
                  <button
                    className="underline tabular-nums"
                    type="button"
                    onClick={() => patch(m, "outputMicroPerToken", "Output microcredits per token")}
                  >
                    {m.outputMicroPerToken}
                  </button>
                </td>
                <td>
                  <button
                    className="underline tabular-nums"
                    type="button"
                    onClick={() => patch(m, "microPerImage", "Microcredits per image")}
                  >
                    {m.microPerImage}
                  </button>
                </td>
                <td className="text-xs">{m.capabilities.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

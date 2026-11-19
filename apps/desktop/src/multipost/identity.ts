import { createHash } from "node:crypto";
export function multipostPartition(workspaceId: string, accountId: string) {
  return (
    "persist:djl-multipost-" +
    createHash("sha256")
      .update(JSON.stringify([workspaceId, accountId]))
      .digest("hex")
  );
}

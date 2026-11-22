import path from "node:path";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { MultiPostScope } from "@djl/contracts";
import { adapters } from "@djl/multipost";
import { MultiPostService } from "./service";
import { MultiPostMcpServer } from "./mcp";
import { MultiPostHostClient } from "./hostClient";
const instances = new WeakMap<
  SqlClient,
  Promise<{ service: MultiPostService; mcp: MultiPostMcpServer }>
>();
export async function multiPostScope(
  root: string,
  threadId: string,
  stateDir?: string,
): Promise<MultiPostScope> {
  const authorizedRoot = await realpath(root);
  const workspaceId = createHash("sha256").update(authorizedRoot).digest("hex");
  return {
    workspaceId,
    threadId,
    authorizedRoot,
    ...(stateDir
      ? {
          mediaRoot: path.join(stateDir, "multipost", "media", workspaceId),
          attachmentsRoot: path.join(stateDir, "attachments"),
        }
      : {}),
  };
}
export function getMultiPost(sql: SqlClient) {
  let instance = instances.get(sql);
  if (!instance) {
    instance = (async () => {
      const service = new MultiPostService(sql, new MultiPostHostClient(), adapters);
      await service.initialize();
      const mcp = new MultiPostMcpServer(service);
      const interval = setInterval(() => {
        void service.runDue().catch(() => {});
      }, 1000);
      interval.unref();
      return { service, mcp };
    })();
    instances.set(sql, instance);
  }
  return instance;
}

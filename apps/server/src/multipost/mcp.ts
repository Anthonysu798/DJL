import { draftSchema, workflowSchema } from "./toolSchemas";
import { multiPostAttachments } from "./media";
import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { MultiPostCommand, MultiPostScope, MultiPostActor } from "@djl/contracts";
import { inspectSocialMedia, mediaEvidenceMcpResult } from "../marketing/mediaEvidence";
interface Service {
  command(
    scope: MultiPostScope,
    command: MultiPostCommand,
    actor: MultiPostActor,
  ): Promise<unknown>;
}
const definitions = [
  [
    "capabilities",
    "Read actual platform and content capabilities; never infer successful publishing.",
    {},
  ],
  [
    "accounts",
    "List/create account profiles or open a scoped login window. User UI verifies identities.",
    {
      action: { type: "string", enum: ["list", "create-account", "connect-account"] },
      platformKey: { type: "string" },
      label: { type: "string" },
      accountId: { type: "string" },
    },
  ],
  [
    "post",
    "Publish one post in a single call: the fastest path for 'post this for me'. Pass the caption, optional photo/video paths (files you created in the workspace, chat Attachments/ or Media/ references) and optional accountIds; omit accountIds to use every signed-in account. DJL picks the right format per platform. If the user switched on Autopilot for those accounts it is queued immediately; otherwise it is saved and the user taps Post on the preview card. Read the returned message, then djl_multipost_jobs for the real result.",
    {
      text: { type: "string", description: "The caption, exactly as it should appear." },
      title: {
        type: "string",
        maxLength: 500,
        description: "Optional. Only for platforms with a separate title, such as video sites.",
      },
      media: {
        type: "array",
        items: { type: "string" },
        maxItems: 20,
        description:
          "Photo or video paths inside the workspace, Attachments/ aliases, or Media/ references.",
      },
      accountIds: { type: "array", items: { type: "string" } },
      scheduledAt: {
        type: ["string", "null"],
        description: "Omit to post now; otherwise a future ISO time with Z or an offset.",
      },
      timezone: { type: "string", description: "IANA timezone for a scheduled post." },
    },
  ],
  [
    "inspect_media",
    "Inspect actual authorized images/video frames before describing their content.",
    { paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 } },
  ],
  [
    "import_media",
    "Import authorized workspace or conversation media into immutable local references. Use returned Media paths in drafts.",
    { paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 } },
  ],
  [
    "draft",
    "Save a versioned draft; never approves or publishes. Read current revision before edits.",
    { draft: draftSchema },
  ],
  [
    "review",
    "Read the exact saved revision for human review in the originating chat/workbench.",
    { draftId: { type: "string" }, revision: { type: "integer" } },
  ],
  [
    "submit",
    "Queue a user-approved revision or one covered by a valid UI-created standing grant. Cannot grant consent.",
    { draftId: { type: "string" }, revision: { type: "integer" }, grantId: { type: "string" } },
  ],
  [
    "schedule",
    "Queue a previously prepared scheduled draft under its existing authorization.",
    { draftId: { type: "string" }, revision: { type: "integer" }, grantId: { type: "string" } },
  ],
  ["jobs", "Read durable per-target states and real evidence. Uncertain is not published.", {}],
  [
    "verify",
    "Verify an uncertain or manually completed task without submitting again.",
    { jobId: { type: "string" } },
  ],
  [
    "cancel",
    "Cancel pending work when requested; platform-owned tasks require verified platform cancellation.",
    { jobId: { type: "string" } },
  ],
  [
    "retry",
    "Request the user UI to review a failed/missed task. Uncertain submissions must be verified first.",
    { jobId: { type: "string" } },
  ],
  [
    "workflow",
    "Save/list versioned publishing workflows; changes invalidate their grants.",
    { workflow: workflowSchema },
  ],
  [
    "authorization",
    "Inspect/revoke standing grants, or request the human authorization UI. Cannot create or expand grants.",
    {
      action: { type: "string", enum: ["list", "request-authorization", "revoke-grant"] },
      workflowId: { type: "string" },
      grantId: { type: "string" },
    },
  ],
] as const;
export const MULTIPOST_TOOLS = definitions.map(([suffix, description, properties]) => ({
  name: `djl_multipost_${suffix}`,
  description,
  inputSchema: {
    type: "object",
    properties,
    ...(suffix === "post" ? { required: ["text"] } : {}),
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: ["capabilities", "jobs", "review", "inspect_media"].includes(suffix),
    openWorldHint: true,
  },
}));
const tokenKey = (token: string) => createHash("sha256").update(token).digest("hex");
export class MultiPostMcpServer {
  private readonly sessions = new Map<string, MultiPostScope>();
  private server: Server | undefined;
  private starting: Promise<string> | undefined;
  constructor(private readonly service: Service) {}
  private start() {
    return (this.starting ??= new Promise<string>((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        const json = (status: number, body: unknown) => {
          res
            .writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
            .end(JSON.stringify(body));
        };
        if (req.headers.origin) {
          json(403, { error: "Browser origins cannot call this MCP endpoint" });
          return;
        }
        if (req.url !== "/mcp/multipost") {
          json(404, { error: "Not found" });
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" }).end();
          return;
        }
        const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        const scope = this.sessions.get(tokenKey(token));
        if (!scope) {
          json(401, { error: "Unauthorized" });
          return;
        }
        let id: unknown = null;
        try {
          let size = 0;
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) throw new Error("MCP body exceeds 2 MiB");
            chunks.push(chunk);
          }
          const input = JSON.parse(Buffer.concat(chunks).toString());
          id = input.id;
          if (input.jsonrpc !== "2.0" || typeof input.method !== "string")
            throw new Error("Invalid JSON-RPC request");
          if (id === undefined) {
            res.writeHead(202).end();
            return;
          }
          let result: unknown;
          switch (input.method) {
            case "initialize":
              result = {
                protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(
                  input.params?.protocolVersion,
                )
                  ? input.params.protocolVersion
                  : "2025-06-18",
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "djl-multipost", title: "DJL multipost mcp", version: "1.0.0" },
              };
              break;
            case "ping":
              result = {};
              break;
            case "tools/list":
              result = { tools: MULTIPOST_TOOLS };
              break;
            case "tools/call": {
              try {
                const name = input.params?.name;
                const args = input.params?.arguments ?? {};
                const tool = MULTIPOST_TOOLS.find((x) => x.name === name);
                if (!tool) throw new Error("Unknown MultiPost tool");
                if (
                  !args ||
                  typeof args !== "object" ||
                  Array.isArray(args) ||
                  Object.keys(args).some((key) => !Object.hasOwn(tool.inputSchema.properties, key))
                )
                  throw new Error("Invalid MultiPost tool arguments");
                if (name === "djl_multipost_inspect_media") {
                  const mediaOnly =
                    Array.isArray(args.paths) &&
                    args.paths.every(
                      (x: unknown) => typeof x === "string" && x.startsWith("Media/"),
                    );
                  const mediaRoot =
                    mediaOnly && scope.mediaRoot ? scope.mediaRoot : scope.authorizedRoot;
                  result = mediaEvidenceMcpResult(
                    await inspectSocialMedia(
                      {
                        ...scope,
                        authorizedRoot: mediaRoot,
                        stateDir: scope.authorizedRoot,
                        attachmentFiles: await multiPostAttachments(scope),
                      },
                      {
                        mediaPaths: mediaOnly
                          ? args.paths.map((x: string) => x.slice(6))
                          : args.paths,
                      },
                    ),
                  );
                  break;
                }
                const actions: Record<string, string> = {
                  post: "quick-post",
                  import_media: "import-media",
                  draft: "save-draft",
                  review: "review-draft",
                  submit: "submit-draft",
                  schedule: "submit-draft",
                  cancel: "cancel-job",
                  verify: "verify-job",
                  retry: "retry-job",
                  workflow: args.workflow ? "save-workflow" : "state",
                  accounts: args.action && args.action !== "list" ? args.action : "state",
                  authorization: args.action && args.action !== "list" ? args.action : "state",
                };
                const suffix = name.slice("djl_multipost_".length);
                const action = actions[suffix] ?? "state";
                if (suffix === "retry") {
                  result = {
                    content: [
                      {
                        type: "text",
                        text: "Review and retry this task from the DJL MultiPost queue.",
                      },
                    ],
                    structuredContent: { requiresUserAction: true, jobId: args.jobId },
                    isError: false,
                  };
                  break;
                }
                const { action: _action, ...fields } = args;
                let value = await this.service.command(
                  scope,
                  (suffix === "post"
                    ? { action, post: fields }
                    : { ...fields, action }) as MultiPostCommand,
                  "agent",
                );
                if (action === "state" && value && typeof value === "object") {
                  const state = value as Record<string, unknown>;
                  if (suffix === "capabilities")
                    value = {
                      capabilities: state.capabilities,
                      runtimeAvailable: state.runtimeAvailable,
                      currentTime: state.currentTime,
                      localTimezone: state.localTimezone,
                      attachments: state.attachments,
                    };
                  if (suffix === "accounts")
                    value = {
                      accounts: (state.accounts as Record<string, unknown>[]).map(
                        ({ homeUrl: _homeUrl, ...account }) => account,
                      ),
                    };
                  if (suffix === "authorization") value = { grants: state.grants };
                  if (suffix === "jobs") value = { jobs: state.jobs };
                  if (suffix === "workflow") value = { workflows: state.workflows };
                }
                const safe = JSON.parse(
                  JSON.stringify(value, (key, value) =>
                    [
                      "homeUrl",
                      "urls",
                      "customInjectUrls",
                      "authorizedRoot",
                      "mediaRoot",
                      "attachmentsRoot",
                      "cookie",
                      "token",
                      "password",
                      "secret",
                      "authorization",
                    ].includes(key)
                      ? undefined
                      : value,
                  ),
                );
                result = {
                  content: [{ type: "text", text: JSON.stringify(safe) }],
                  structuredContent: Array.isArray(safe)
                    ? suffix === "import_media"
                      ? { media: safe }
                      : { jobs: safe }
                    : safe,
                  isError: false,
                };
              } catch (error) {
                result = {
                  content: [
                    {
                      type: "text",
                      text: error instanceof Error ? error.message : "MultiPost failed",
                    },
                  ],
                  isError: true,
                };
              }
              break;
            }
            default:
              json(200, {
                jsonrpc: "2.0",
                id,
                error: { code: -32601, message: "Method not found" },
              });
              return;
          }
          json(200, { jsonrpc: "2.0", id, result });
        } catch (error) {
          json(400, {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32600,
              message: error instanceof Error ? error.message : "Invalid request",
            },
          });
        }
      });
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server!.address();
        if (!address || typeof address === "string") return reject(new Error("No MCP address"));
        resolve(`http://127.0.0.1:${address.port}/mcp/multipost`);
      });
    }));
  }
  async register(scope: MultiPostScope) {
    const url = await this.start();
    const bearerToken = randomBytes(32).toString("base64url");
    this.sessions.set(tokenKey(bearerToken), scope);
    return {
      name: `djl_multipost_${createHash("sha256").update(scope.threadId).digest("hex").slice(0, 12)}`,
      url,
      bearerToken,
    };
  }
  unregister(token: string) {
    this.sessions.delete(tokenKey(token));
  }
  async close() {
    this.sessions.clear();
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        this.server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
}

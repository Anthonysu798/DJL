import { eq, lt, sql, like, and } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  validateServerOperation,
  SERVER_TARGETS,
  type ServerOperation,
  type ServerOverview,
  type ServerJob,
} from "@djl/domain";
import { requirePermission, type AdminPrincipal, type AdminAuth } from "../admin/AdminAuth.ts";
import { writeAudit } from "../audit/AuditLog.ts";
import { ApiError } from "../http/errors.ts";
import type { HostController } from "./ControllerClient.ts";
import type { TrafficMonitor } from "./TrafficMonitor.ts";

interface Receipt {
  actorId: string;
  operation: ServerOperation;
  status: string;
  authorizedAt: number;
}
export class ServerOperations {
  constructor(
    private readonly db: DjlDatabase,
    private readonly controller: HostController,
    private readonly auth: Pick<AdminAuth, "verifyOperationCode">,
    private readonly traffic: Pick<TrafficMonitor, "snapshot">,
    private readonly controlAdmins: readonly string[] | null = null,
  ) {}
  private authorize(p: AdminPrincipal, permission: string) {
    requirePermission(p, permission);
    if (
      permission === "servers.control" &&
      this.controlAdmins !== null &&
      !this.controlAdmins.includes(p.adminId)
    )
      throw new ApiError(
        403,
        "operator_required",
        "VPS controls are restricted to explicitly authorized operators.",
      );
    if (!p.mfaVerified) throw new ApiError(403, "mfa_required", "Administrator MFA is required.");
  }
  async overview(p: AdminPrincipal, range: string) {
    this.authorize(p, "servers.read");
    if (!["hour", "day", "week"].includes(range))
      throw new ApiError(400, "bad_request", "Choose an hour, day or week.");
    const result = await this.controller.request<Omit<ServerOverview, "traffic">>(
      "/overview?range=" + range,
    );
    await Promise.all(
      result.jobs
        .filter((job) => ["succeeded", "failed", "scheduled"].includes(job.status))
        .map((job) => this.finalize(job)),
    );
    const traffic = await this.traffic.snapshot(range as "hour" | "day" | "week").catch(() => null);
    return {
      ...result,
      traffic,
      canControl: this.controlAdmins === null || this.controlAdmins.includes(p.adminId),
    };
  }
  async logs(p: AdminPrincipal, target: string) {
    this.authorize(p, "servers.read");
    if (!SERVER_TARGETS.includes(target as never))
      throw new ApiError(400, "bad_request", "Choose a DJL service.");
    return this.controller.request<{ service: string; lines: string[]; at: number }>(
      "/logs?service=" + target,
    );
  }
  async submit(p: AdminPrincipal, body: unknown) {
    this.authorize(p, "servers.control");
    let operation: ServerOperation;
    try {
      operation = validateServerOperation(body);
    } catch (error) {
      throw new ApiError(400, "bad_request", (error as Error).message);
    }
    const key = "operations.request." + operation.requestId;
    const existing = await this.db.query.settings.findFirst({
      where: eq(schema.settings.key, key),
    });
    if (existing) {
      const receipt = existing.value as Receipt;
      if (
        receipt.actorId !== p.adminId ||
        JSON.stringify(validateServerOperation(receipt.operation)) !== JSON.stringify(operation)
      )
        throw new ApiError(
          409,
          "request_conflict",
          "Request ID already used for another operation.",
        );
      if (receipt.status !== "authorized") return { id: operation.requestId };
      if (Date.now() - receipt.authorizedAt > 300_000)
        throw new ApiError(
          410,
          "authorization_expired",
          "Operation authorization expired. Confirm again with a new request and authenticator code.",
        );
    } else {
      const step =
        operation.action === "acknowledge"
          ? null
          : await this.auth.verifyOperationCode(p, (body as Record<string, unknown>).totp);
      await this.db.transaction(async (tx) => {
        if (step !== null) {
          const fresh = await tx
            .insert(schema.settings)
            .values({ key: "operations.mfa." + p.adminId, value: step })
            .onConflictDoUpdate({
              target: schema.settings.key,
              set: { value: step },
              where: lt(sql.raw('"settings"."value"::text::bigint'), step),
            })
            .returning();
          if (!fresh.length)
            throw new ApiError(
              409,
              "code_used",
              "This authenticator code was already used. Wait for the next code.",
            );
        }
        const inserted = await tx
          .insert(schema.settings)
          .values({
            key,
            value: {
              actorId: p.adminId,
              operation,
              status: "authorized",
              authorizedAt: Date.now(),
            },
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted.length)
          throw new ApiError(
            409,
            "request_conflict",
            "Request is already being submitted. Retry with the same request ID.",
          );
        await writeAudit(tx, {
          actorType: "admin",
          actorId: p.adminId,
          action: "server." + operation.action + ".requested",
          targetType: "vps",
          targetId: operation.target,
          after: { requestId: operation.requestId, releaseId: operation.releaseId ?? null },
          reason: operation.reason,
        });
      });
    }
    const result = await this.controller.request<{ id: string }>("/operations", operation);
    return result;
  }
  async receipt(p: AdminPrincipal, id: string) {
    this.authorize(p, "servers.read");
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new ApiError(400, "bad_request", "Invalid operation ID.");
    const job = await this.controller.request<ServerJob>("/operations/" + id);
    await this.finalize(job);
    return job;
  }
  /** Complete audit outcomes even when the browser closes during an operation. */
  async reconcile() {
    const rows = await this.db.query.settings.findMany({
      where: and(
        like(schema.settings.key, "operations.request.%"),
        sql.raw("value->>'status' = 'authorized'"),
      ),
      limit: 100,
      orderBy: [schema.settings.updatedAt],
    });
    for (const row of rows) {
      const receipt = row.value as Receipt;
      if (receipt.status !== "authorized") continue;
      try {
        const job = await this.controller.request<ServerJob>(
          "/operations/" + receipt.operation.requestId,
        );
        await this.finalize(job);
      } catch (error) {
        if (error instanceof ApiError && error.status === 503) break;
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          Date.now() - receipt.authorizedAt > 300_000
        ) {
          await this.finalize({
            id: receipt.operation.requestId,
            action: receipt.operation.action,
            target: receipt.operation.target,
            status: "failed",
            createdAt: receipt.authorizedAt / 1000,
            finishedAt: Date.now() / 1000,
            message: "Authorization expired before the controller accepted this operation.",
          });
        }
      }
    }
  }
  private async finalize(job: ServerJob) {
    if (["succeeded", "failed", "scheduled"].includes(job.status)) {
      await this.db.transaction(async (tx) => {
        const key = "operations.request." + job.id;
        const [row] = await tx
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, key))
          .for("update");
        const receipt = row?.value as Receipt | undefined;
        if (receipt && receipt.status === "authorized") {
          await tx
            .update(schema.settings)
            .set({ value: { ...receipt, status: job.status } })
            .where(eq(schema.settings.key, key));
          await writeAudit(tx, {
            actorType: "admin",
            actorId: receipt.actorId,
            action: "server." + receipt.operation.action + "." + job.status,
            targetType: "vps",
            targetId: receipt.operation.target,
            after: { requestId: job.id, status: job.status },
            reason: receipt.operation.reason,
          });
        }
      });
    }
  }
}

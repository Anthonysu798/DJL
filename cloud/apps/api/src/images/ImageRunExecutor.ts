import { and, eq, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { CloudMessagePart, CloudRunError } from "@synara/contracts/cloud";
import { imageBytes, saveGeneratedImage } from "../agent/imageTools.ts";
import { textOf } from "../chat/ChatService.ts";
import type { GatewayService, RequestFacts } from "../gateway/GatewayService.ts";
import type { RunExecutor } from "../runs/RunExecutor.ts";
import type { RunLog } from "../runs/RunLog.ts";
import type { RunRow } from "../runs/wire.ts";
import type { BlobStore } from "../sync/BlobStore.ts";
import type { OrgRole } from "../auth/guard.ts";

export class ImageRunExecutor implements RunExecutor {
  private readonly owner = crypto.randomUUID();
  constructor(
    private readonly deps: {
      db: DjlDatabase;
      blobs: BlobStore;
      log: RunLog;
      gateway: Pick<GatewayService, "generateImage">;
      notifier?: { runFinished: (run: RunRow) => Promise<unknown> };
    },
  ) {}
  async execute(runId: string, signal: AbortSignal): Promise<void> {
    const claimed = await this.deps.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.id, runId))
        .for("update");
      if (!run || !run.imageAspectRatio || !["queued", "running"].includes(run.status)) return null;
      if (
        run.status === "running" &&
        run.leaseExpiresAt &&
        run.leaseExpiresAt.getTime() > Date.now()
      )
        return null;
      await tx
        .update(schema.runs)
        .set({
          status: "running",
          leaseOwner: this.owner,
          leaseExpiresAt: sql`now() + interval '60 seconds'`,
          startedAt: run.startedAt ?? new Date(),
        })
        .where(eq(schema.runs.id, runId));
      return run;
    });
    if (!claimed) return;
    const run = claimed,
      log = this.deps.log.writer(run.id, run.lastSeq);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    let cancelled = Boolean(run.cancelRequestedAt),
      lost = false;
    const heartbeat = setInterval(() => {
      void this.deps.db
        .update(schema.runs)
        .set({ leaseExpiresAt: sql`now() + interval '60 seconds'` })
        .where(
          and(
            eq(schema.runs.id, run.id),
            eq(schema.runs.leaseOwner, this.owner),
            eq(schema.runs.status, "running"),
          ),
        )
        .returning({ cancel: schema.runs.cancelRequestedAt })
        .then((rows) => {
          if (!rows.length) {
            lost = true;
            controller.abort();
          } else if (rows[0]?.cancel) {
            cancelled = true;
            controller.abort();
          }
        })
        .catch(() => {
          lost = true;
          controller.abort();
        });
    }, 1000);
    let parts: CloudMessagePart[] = [],
      status: "succeeded" | "failed" | "cancelled" = "failed",
      error: CloudRunError | null = null;
    try {
      const message = await this.deps.db.query.messages.findFirst({
        where: eq(schema.messages.id, run.messageId),
      });
      parts = (message?.parts ?? []) as CloudMessagePart[];
      if (cancelled) {
        status = "cancelled";
        return;
      }
      const saved = await this.deps.db.query.files.findFirst({
        where: and(
          eq(schema.files.id, run.id),
          eq(schema.files.messageId, run.messageId),
          eq(schema.files.userId, run.userId),
          eq(schema.files.orgId, run.orgId),
          eq(schema.files.status, "ready"),
        ),
      });
      if (saved && !parts.some((p) => p.type === "image_ref")) {
        const part = {
          type: "image_ref" as const,
          fileId: saved.id,
          mimeType: saved.mimeType,
          width: saved.width,
          height: saved.height,
        } as CloudMessagePart;
        parts = [part];
        await this.deps.db
          .update(schema.messages)
          .set({ parts })
          .where(eq(schema.messages.id, run.messageId));
        await log.append("message.part", { messageId: run.messageId, part });
      }
      if (parts.some((p) => p.type === "image_ref")) {
        status = "succeeded";
        return;
      }
      if (run.status === "running")
        throw new Error(
          "The previous image request was interrupted. Start a new request to try again.",
        );
      const user = await this.deps.db.query.user.findFirst({
        where: eq(schema.user.id, run.userId),
      });
      const member = await this.deps.db.query.member.findFirst({
        where: and(
          eq(schema.member.userId, run.userId),
          eq(schema.member.organizationId, run.orgId),
        ),
      });
      const conversation = await this.deps.db.query.conversations.findFirst({
        where: eq(schema.conversations.id, run.conversationId),
      });
      if (!user || user.banned || !member || conversation?.deletedAt)
        throw new Error("This account can no longer run this task.");
      const parent = message?.parentId
        ? await this.deps.db.query.messages.findFirst({
            where: eq(schema.messages.id, message.parentId),
          })
        : null;
      const facts: RequestFacts = {
        principal: {
          userId: run.userId,
          email: user.email,
          emailVerified: user.emailVerified,
          banned: false,
          orgId: run.orgId,
          personalOrgId: run.orgId,
          role: member.role as OrgRole,
          sessionId: `image:${run.id}`,
        },
        traceId: `run-${run.id}`,
        ipHash: null,
        deviceId: null,
      };
      await log.append("status", { status: "running", error: null });
      if (controller.signal.aborted) throw new Error("The image request was interrupted.");
      const result = await this.deps.gateway.generateImage(
        facts,
        {
          model: run.model,
          prompt: textOf(parent?.parts ?? []),
          n: 1,
          size:
            (
              { "1:1": "1024x1024", "4:3": "1536x1024", "3:4": "1024x1536" } as Record<
                string,
                string
              >
            )[run.imageAspectRatio!] ?? "1024x1024",
        },
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5 * 60_000)]) },
      );
      if (controller.signal.aborted) throw new Error("The image request was interrupted.");
      if (result.data.length !== 1) throw new Error("The provider returned no image.");
      const part = await saveGeneratedImage(
        this.deps,
        run,
        await imageBytes(result.data[0]!, controller.signal),
        run.id,
      );
      parts = [part];
      await this.deps.db
        .update(schema.messages)
        .set({ parts })
        .where(eq(schema.messages.id, run.messageId));
      await log.append("message.part", { messageId: run.messageId, part });
      await this.deps.db
        .update(schema.runs)
        .set({ spentMicro: BigInt(result.usage.settled) })
        .where(and(eq(schema.runs.id, run.id), eq(schema.runs.leaseOwner, this.owner)));
      status = "succeeded";
    } catch (e) {
      status = cancelled ? "cancelled" : "failed";
      error =
        status === "failed"
          ? {
              code: "image_failed",
              message:
                e instanceof Error ? e.message : "The image request failed. Try a new request.",
            }
          : null;
    } finally {
      clearInterval(heartbeat);
      signal.removeEventListener("abort", abort);
      if (!lost) {
        await log.append("status", { status, error });
        await log.flush();
        const [finished] = await this.deps.db
          .update(schema.runs)
          .set({ status, error, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
          .where(and(eq(schema.runs.id, run.id), eq(schema.runs.leaseOwner, this.owner)))
          .returning();
        if (finished) await this.deps.notifier?.runFinished(finished).catch(() => undefined);
      }
    }
  }
}

import { afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@djl/db";
import { chatHarness } from "../testing/chat.ts";
import { ImageService } from "./ImageService.ts";
import { ImageRunExecutor } from "./ImageRunExecutor.ts";
const h = chatHarness();
afterAll(() => h.close());
const available = {
  listModels: async () => [
    { id: "gpt-image-1", capabilities: ["image.generate"], status: "active" },
  ],
};
const service = new ImageService({ db: h.db, chat: h.chat, gateway: available as never });
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAA", "base64"));

it("creates a retry-safe owned image task and one generated gallery entry", async () => {
  const { p, facts } = await h.user("image-task");
  const c = await h.chat.create(p, {});
  const input = {
    clientMessageId: crypto.randomUUID(),
    prompt: "A blue desk",
    aspectRatio: "1:1" as const,
  };
  const first = await service.create(facts, c.id, input);
  const again = await service.create(facts, c.id, input);
  expect(first.run.id).toBe(again.run.id);
  expect(first.reply.id).toBe(again.reply.id);
  const calls: { count: number } = { count: 0 };
  const executor = new ImageRunExecutor({
    db: h.db,
    blobs: h.blobs,
    log: h.log,
    gateway: {
      generateImage: async () => {
        calls.count++;
        return {
          created: 0,
          data: [{ b64_json: Buffer.from(png).toString("base64"), mediaType: "image/png" }],
          usage: {
            settled: "7",
            requestId: crypto.randomUUID(),
            model: "image.generate",
            routeReason: "alias" as const,
            images: 1,
            remaining: "0",
          },
        };
      },
    },
  });
  await Promise.all([
    executor.execute(first.run.id, new AbortController().signal),
    executor.execute(first.run.id, new AbortController().signal),
  ]);
  await executor.execute(first.run.id, new AbortController().signal);
  expect(calls.count).toBe(1);
  const page = await service.list(p);
  expect(page.images).toHaveLength(1);
  expect(page.images[0]?.conversationId).toBe(c.id);
  expect(page.images[0]?.messageId).toBe(first.reply.id);
  const events = await h.log.read(first.run.id, 0);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  expect(events.at(-1)?.payload).toMatchObject({ status: "succeeded" });
  const other = await h.user("other-image");
  expect((await service.list(other.p)).images).toHaveLength(0);
  await expect(service.create(other.facts, c.id, input)).rejects.toMatchObject({ status: 404 });
  await h.chat.remove(p, c.id);
  expect((await service.list(p)).images).toHaveLength(0);
});

it("rejects unsupported models before storing a task", async () => {
  const { p, facts } = await h.user("image-disabled");
  const c = await h.chat.create(p, {});
  const disabled = new ImageService({
    db: h.db,
    chat: h.chat,
    gateway: { listModels: async () => [] },
  });
  await expect(
    disabled.create(facts, c.id, {
      clientMessageId: crypto.randomUUID(),
      prompt: "Desk",
      aspectRatio: "1:1",
    }),
  ).rejects.toMatchObject({ status: 503 });
  expect(
    await h.db.select().from(schema.runs).where(eq(schema.runs.conversationId, c.id)),
  ).toHaveLength(0);
});

it("does not generate cancelled tasks or repeat an ambiguous provider call", async () => {
  const { p, facts } = await h.user("image-interrupted");
  const c = await h.chat.create(p, {});
  const task = () =>
    service.create(facts, c.id, {
      clientMessageId: crypto.randomUUID(),
      prompt: "Desk",
      aspectRatio: "1:1",
    });
  const cancelled = await task();
  await h.db
    .update(schema.runs)
    .set({ cancelRequestedAt: new Date() })
    .where(eq(schema.runs.id, cancelled.run.id));
  let count = 0;
  const executor = new ImageRunExecutor({
    db: h.db,
    blobs: h.blobs,
    log: h.log,
    gateway: {
      generateImage: async () => {
        count++;
        throw new Error("Provider unavailable");
      },
    },
  });
  await executor.execute(cancelled.run.id, new AbortController().signal);
  expect(count).toBe(0);
  const ambiguous = await task();
  await h.db
    .update(schema.runs)
    .set({ status: "running", leaseExpiresAt: sql`now() - interval '1 minute'` })
    .where(eq(schema.runs.id, ambiguous.run.id));
  await executor.execute(ambiguous.run.id, new AbortController().signal);
  expect(count).toBe(0);
  expect((await h.runs.get(p, ambiguous.run.id)).run.status).toBe("failed");
  const failed = await task();
  await executor.execute(failed.run.id, new AbortController().signal);
  await executor.execute(failed.run.id, new AbortController().signal);
  expect(count).toBe(1);
  expect((await h.runs.get(p, failed.run.id)).run.status).toBe("failed");
});

it("pages private metadata without skipping equal timestamps or embedding bytes", async () => {
  const { p, facts } = await h.user("image-pages");
  const c = await h.chat.create(p, {});
  const result = await service.create(facts, c.id, {
    clientMessageId: crypto.randomUUID(),
    prompt: "Desk",
    aspectRatio: "1:1",
  });
  const at = new Date("2026-10-12T00:00:00Z");
  await h.db.insert(schema.files).values(
    Array.from({ length: 31 }, () => ({
      orgId: p.orgId,
      userId: p.userId,
      messageId: result.reply.id,
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 24,
      storageKey: crypto.randomUUID(),
      status: "ready" as const,
      source: "generated",
      purpose: "image",
      createdAt: at,
    })),
  );
  const first = await service.list(p);
  const last = await service.list(p, first.nextCursor!);
  expect(first.images).toHaveLength(30);
  expect(last.images).toHaveLength(1);
  expect(new Set([...first.images, ...last.images].map((i) => i.fileId)).size).toBe(31);
  expect(Object.keys(first.images[0]!)).not.toContain("storageKey");
  expect(Object.keys(first.images[0]!)).not.toContain("url");
  await expect(service.list(p, "invalid")).rejects.toMatchObject({ status: 400 });
});

it("a heartbeat database error fails the job so safe recovery runs instead of acknowledging unfinished work", async () => {
  const { facts, p } = await h.user("image-heartbeat");
  const c = await h.chat.create(p, {});
  const task = await service.create(facts, c.id, {
    clientMessageId: crypto.randomUUID(),
    prompt: "Desk",
    aspectRatio: "1:1",
  });
  class FailingLeaseExecutor extends ImageRunExecutor {
    protected override async renewLease(): Promise<never> {
      throw new Error("Transient database failure");
    }
  }
  const executor = new FailingLeaseExecutor({
    db: h.db,
    blobs: h.blobs,
    log: h.log,
    gateway: {
      generateImage: async (_facts, _input, options) => {
        await new Promise<void>((resolve) =>
          options!.signal!.addEventListener("abort", () => resolve(), { once: true }),
        );
        throw new Error("Interrupted");
      },
    },
  });
  await expect(executor.execute(task.run.id, new AbortController().signal)).rejects.toThrow();
});

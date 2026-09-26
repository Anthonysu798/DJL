/**
 * Chat test harness: the real services over the test database and Redis,
 * a gateway on the deterministic fake provider (slowed to 10 ms per chunk so
 * a stream can be cancelled or left mid-way), and an in-memory task queue.
 */
import { creditsToMicro } from "@djl/domain";
import type { ProviderAdapter } from "@djl/providers";
import { Redis } from "ioredis";

import type { Principal } from "../auth/guard.ts";
import { ChatService } from "../chat/ChatService.ts";
import { Settings } from "../config/settings.ts";
import { LedgerService } from "../credits/LedgerService.ts";
import { FileService } from "../files/FileService.ts";
import { createFakeProvider } from "../gateway/fakeProvider.ts";
import { GatewayService, type RequestFacts } from "../gateway/GatewayService.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ChatRunner } from "../runs/ChatRunner.ts";
import { RunLog } from "../runs/RunLog.ts";
import { RunService } from "../runs/RunService.ts";
import { ShareService } from "../shares/ShareService.ts";
import { FakeBlobStore } from "../sync/BlobStore.ts";
import { seedOrg, testDatabase } from "./db.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function slow(provider: ProviderAdapter, id: ProviderAdapter["id"]): ProviderAdapter {
  return {
    ...provider,
    id,
    async *chatStream(req, signal) {
      for await (const chunk of provider.chatStream(req, signal)) {
        await sleep(10);
        yield chunk;
      }
    },
  };
}

export function chatHarness() {
  const conn = testDatabase();
  const db = conn.db;
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63799", {
    maxRetriesPerRequest: 2,
  });
  const ledger = new LedgerService(db);
  const settings = new Settings(db, { ttlMs: 0 });
  const fake = createFakeProvider();
  const gateway = new GatewayService({
    db,
    ledger,
    limiter: createMemoryRateLimiter(),
    settings,
    providers: {
      openai: slow(fake, "openai"),
      anthropic: slow(fake, "anthropic"),
      openrouter: slow(fake, "openrouter"),
    },
    trial: { onFirstCloudRequest: async () => false },
    config: { region: "test", catalogTtlMs: 0, refusalFlagThreshold: 100 },
  });
  const blobs = new FakeBlobStore();
  const log = new RunLog(db, redis);
  const runner = new ChatRunner({ db, gateway, log, blobs, cancelPollMs: 20 });
  const enqueued: string[] = [];
  const files = new FileService(db, blobs, settings);
  const chat = new ChatService({
    db,
    files,
    runner,
    tasks: { enqueue: async (runId) => void enqueued.push(runId) },
  });
  const runs = new RunService(db, log, 200);
  const shares = new ShareService(db, chat, blobs, "https://app.test");

  /** A user in a fresh org with 100 credits. */
  async function user(label: string): Promise<{ p: Principal; facts: RequestFacts }> {
    const { orgId, userId } = await seedOrg(db, label);
    await ledger.grant({
      orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(100),
      idempotencyKey: `chat-test:${orgId}`,
      actor: "test",
    });
    const p: Principal = {
      userId,
      email: `${label}@test.invalid`,
      emailVerified: true,
      banned: false,
      sessionId: "s",
      orgId,
      role: "owner",
      personalOrgId: orgId,
    };
    return { p, facts: { principal: p, traceId: "t", ipHash: null, deviceId: null } };
  }

  /** Declare, "upload" (as the client's PUT would), and complete a file. */
  async function uploadFile(
    p: Principal,
    bytes: Uint8Array,
    options: {
      readonly mimeType: string;
      readonly purpose?: "attachment" | "image";
      readonly declared?: { readonly size?: number; readonly sha256?: string };
    },
  ) {
    const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
    const created = await files.create(p, {
      name: "upload.bin",
      mimeType: options.mimeType,
      size: options.declared?.size ?? bytes.byteLength,
      sha256: options.declared?.sha256 ?? sha256.toString("hex"),
      purpose: options.purpose ?? "attachment",
    } as never);
    const key = `org/${p.orgId}/files/${created.file.id}`;
    blobs.put(key, bytes, options.mimeType);
    return {
      id: created.file.id,
      key,
      created,
      complete: () => files.complete(p, created.file.id),
    };
  }

  return {
    db,
    redis,
    ledger,
    blobs,
    log,
    runner,
    files,
    chat,
    runs,
    shares,
    enqueued,
    user,
    uploadFile,
    close: async () => {
      await runner.stop();
      redis.disconnect();
      await conn.close();
    },
  };
}

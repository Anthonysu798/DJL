/**
 * Builds the agent runtime the worker runs `agent.run` jobs with, from the
 * environment. With DJL_MOCK_EXTERNALS the model, search, sandbox, and push
 * are all fakes: nothing leaves the machine and no user code ever runs.
 *
 * Environment (outside mock mode):
 *   EXA_API_KEY                        web_search and read_page
 *   FLY_API_TOKEN_SANDBOX, FLY_SANDBOX_APP, FLY_SANDBOX_IMAGE, FLY_SANDBOX_REGION (optional)
 *   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_TOPIC (default app.djl.ios)
 *   plus the gateway's provider keys (OPENAI_API_KEY, ...).
 */
import type { DjlDatabase } from "@djl/db";
import { MockPushSender, createApnsSender, type EmailSender, type PushSender } from "@djl/notify";
import type { Redis } from "ioredis";

import { Settings } from "../config/settings.ts";
import { LedgerService } from "../credits/LedgerService.ts";
import { GatewayService } from "../gateway/GatewayService.ts";
import { buildProviders } from "../gateway/providers.ts";
import { createMemoryRateLimiter, createRedisRateLimiter } from "../gateway/RateLimiter.ts";
import { RunLog } from "../runs/RunLog.ts";
import type { BlobStore } from "../sync/BlobStore.ts";
import { TrialService } from "../trial/TrialService.ts";
import { AgentRunner } from "./AgentRunner.ts";
import { createExaClient, createFakeWebSearch } from "./exa.ts";
import { createImageTools } from "./imageTools.ts";
import { RunNotifier } from "./RunNotifier.ts";
import { FlyMachines, reapSandboxes } from "./sandbox/FlyMachines.ts";
import { createFlySandbox, createMockSandbox, type Sandbox } from "./sandbox/Sandbox.ts";
import { createSandboxTools } from "./sandboxTools.ts";
import { ToolBilling } from "./ToolBilling.ts";
import { createWebTools } from "./webTools.ts";

export {
  AGENT_RUN_JOB,
  AGENT_RUN_QUEUE_OPTIONS,
  type AgentRunJobData,
} from "../runs/RunExecutor.ts";
export { RunInterruptedError } from "./AgentRunner.ts";
export { resumeBlockedRuns, windowsHaveRoom } from "./resume.ts";

export interface AgentRuntimeInput {
  readonly db: DjlDatabase;
  readonly redis: Redis;
  readonly blobs: BlobStore;
  readonly email: EmailSender;
  readonly mockExternals: boolean;
  readonly webPublicUrl: string;
  readonly env: NodeJS.ProcessEnv;
  readonly onAlert?: (alert: {
    readonly severity: "warn" | "p0";
    readonly title: string;
    readonly body: string;
  }) => void;
}

export interface AgentRuntime {
  readonly runner: AgentRunner;
  /** Destroys stray sandbox machines; null in mock mode. */
  readonly reap: (() => Promise<number>) | null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function createAgentRuntime(input: AgentRuntimeInput): AgentRuntime {
  const { db, redis, blobs, env, mockExternals } = input;
  const ledger = new LedgerService(db);
  const settings = new Settings(db);
  const onAlert = input.onAlert ?? (() => undefined);
  const gateway = new GatewayService({
    db,
    ledger,
    settings,
    limiter: mockExternals ? createMemoryRateLimiter() : createRedisRateLimiter(redis),
    providers: buildProviders({ mockExternals }, env, onAlert),
    // Only onFirstCloudRequest is used here; the phone lookup belongs to claims.
    trial: new TrialService(
      db,
      ledger,
      { lookupLineType: async () => "unknown" },
      { credits: 200, expiryDays: 14, dailyBudgetUsdCents: 10_000, hashSalt: "" },
    ),
    config: { region: env.FLY_REGION ?? "local", catalogTtlMs: 30_000, refusalFlagThreshold: 10 },
    onAlert,
  });

  let sandbox: Sandbox;
  let reap: AgentRuntime["reap"] = null;
  let push: PushSender;
  if (mockExternals) {
    sandbox = createMockSandbox();
    push = new MockPushSender();
  } else {
    const machines = new FlyMachines({
      token: required(env, "FLY_API_TOKEN_SANDBOX"),
      app: required(env, "FLY_SANDBOX_APP"),
      image: required(env, "FLY_SANDBOX_IMAGE"),
      ...(env.FLY_SANDBOX_REGION ? { region: env.FLY_SANDBOX_REGION } : {}),
    });
    sandbox = createFlySandbox(machines);
    reap = () => reapSandboxes(machines);
    push = createApnsSender({
      keyId: required(env, "APNS_KEY_ID"),
      teamId: required(env, "APNS_TEAM_ID"),
      privateKey: required(env, "APNS_PRIVATE_KEY").replaceAll("\\n", "\n"),
      topic: env.APNS_TOPIC ?? "app.djl.ios",
    });
  }
  const web = mockExternals
    ? createFakeWebSearch()
    : createExaClient({ apiKey: required(env, "EXA_API_KEY") });

  const runner = new AgentRunner({
    db,
    blobs,
    settings,
    gateway,
    sandbox,
    log: new RunLog(db, redis),
    billing: new ToolBilling(db, ledger),
    notifier: new RunNotifier({ db, push, email: input.email, webPublicUrl: input.webPublicUrl }),
    tools: [
      ...createWebTools(web),
      ...createImageTools({ db, blobs, gateway }),
      ...createSandboxTools({ db, blobs }),
    ],
  });
  return { runner, reap };
}

/**
 * Builds the agent runtime the worker runs `agent.run` jobs with, from the
 * environment. With DJL_MOCK_EXTERNALS the model, search, sandbox, and push
 * are all fakes: nothing leaves the machine and no user code ever runs.
 *
 * Search and push are enabled when their credentials are configured.
 * SANDBOX_BACKEND=disabled runs chat agents without Python or document parsing.
 */
import type { DjlDatabase } from "@djl/db";
import { MockPushSender, createApnsSender, type EmailSender, type PushSender } from "@djl/notify";
import type { Redis } from "ioredis";

import { Settings } from "../config/settings.ts";
import { LedgerService } from "../credits/LedgerService.ts";
import { GatewayService } from "../gateway/GatewayService.ts";
import { buildProviders } from "../gateway/providers.ts";
import { createMemoryRateLimiter, createRedisRateLimiter } from "../gateway/RateLimiter.ts";
import { ImageRunExecutor } from "../images/ImageRunExecutor.ts";
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
  IMAGE_RUN_JOB,
  IMAGE_RUN_QUEUE_OPTIONS,
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
  readonly imageRunner: ImageRunExecutor;
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
  let push: PushSender | null = null;
  const sandboxEnabled = mockExternals || env.SANDBOX_BACKEND !== "disabled";
  if (mockExternals) {
    sandbox = createMockSandbox();
    push = new MockPushSender();
  } else {
    if (sandboxEnabled) {
      if (env.SANDBOX_BACKEND && env.SANDBOX_BACKEND !== "fly")
        throw new Error("SANDBOX_BACKEND must be disabled or fly");
      const machines = new FlyMachines({
        token: required(env, "FLY_API_TOKEN_SANDBOX"),
        app: required(env, "FLY_SANDBOX_APP"),
        image: required(env, "FLY_SANDBOX_IMAGE"),
        ...(env.FLY_SANDBOX_REGION ? { region: env.FLY_SANDBOX_REGION } : {}),
      });
      sandbox = createFlySandbox(machines);
      reap = () => reapSandboxes(machines);
    } else {
      sandbox = {
        open: async () => {
          throw new Error("Code execution is disabled on this server.");
        },
      };
    }
    if (env.APNS_KEY_ID || env.APNS_TEAM_ID || env.APNS_PRIVATE_KEY)
      push = createApnsSender({
        keyId: required(env, "APNS_KEY_ID"),
        teamId: required(env, "APNS_TEAM_ID"),
        privateKey: required(env, "APNS_PRIVATE_KEY").replaceAll("\\n", "\n"),
        topic: env.APNS_TOPIC ?? "app.djl.ios",
      });
  }
  const searchEnabled = mockExternals || Boolean(env.EXA_API_KEY);
  const web = mockExternals
    ? createFakeWebSearch()
    : env.EXA_API_KEY
      ? createExaClient({ apiKey: env.EXA_API_KEY })
      : {
          search: async () => {
            throw new Error("Web search is not configured.");
          },
          contents: async () => null,
        };

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
      ...createWebTools(web).filter((tool) => searchEnabled || tool.name === "read_page"),
      ...createImageTools({ db, blobs, gateway }),
      ...createSandboxTools({ db, blobs, sandboxEnabled }),
    ],
  });
  return {
    runner,
    reap,
    imageRunner: new ImageRunExecutor({
      db,
      blobs,
      gateway,
      log: new RunLog(db, redis),
      notifier: new RunNotifier({ db, push, email: input.email, webPublicUrl: input.webPublicUrl }),
    }),
  };
}

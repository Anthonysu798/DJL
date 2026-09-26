/**
 * Throwaway code-interpreter machines on Fly, through the Machines REST API.
 *
 * Each task run that needs Python gets one machine in the sandbox app (a
 * separate Fly organization with no public IP and no services): 1 shared CPU,
 * 1 GB, `auto_destroy`, never restarted, labelled with the run id. Commands
 * run through the exec API; inside the image every piece of user code runs
 * under nsjail with no network namespace, seccomp, rlimits, a read-only root,
 * and a tmpfs /work (see infra/fly/sandbox). The machine is destroyed in
 * `finally`, its image stops it after 15 minutes regardless, and the
 * `sandbox.reap` job destroys anything older than 20 minutes.
 */
export interface FlyMachinesConfig {
  readonly token: string;
  readonly app: string;
  readonly image: string;
  readonly region?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface FlyMachine {
  readonly id: string;
  readonly created_at: string;
  readonly config?: { readonly metadata?: Readonly<Record<string, string>> };
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Wall time of the exec call, for billing. */
  readonly seconds: number;
}

export const SANDBOX_ROLE = "djl-sandbox";
/** Per exec, enforced by the exec API and by nsjail's time_limit. */
export const EXEC_TIMEOUT_SECONDS = 60;
/** A machine is replaced before it reaches its 15-minute self-stop. */
export const MACHINE_MAX_AGE_MS = 14 * 60_000;
/** The reaper destroys any sandbox machine older than this. */
export const REAP_AFTER_MS = 20 * 60_000;

export class FlyMachines {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: FlyMachinesConfig) {
    this.baseUrl = config.baseUrl ?? "https://api.machines.dev/v1";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** The create-machine body for one run. */
  machineConfig(runId: string) {
    return {
      name: `sbx-${runId.slice(0, 8)}-${crypto.randomUUID().slice(0, 6)}`,
      ...(this.config.region ? { region: this.config.region } : {}),
      skip_service_registration: true,
      config: {
        image: this.config.image,
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
        auto_destroy: true,
        restart: { policy: "no" },
        services: [],
        metadata: { djl_role: SANDBOX_ROLE, djl_run_id: runId },
      },
    };
  }

  async create(runId: string): Promise<FlyMachine> {
    const machine = await this.call<FlyMachine>("POST", "/machines", this.machineConfig(runId));
    await this.call(
      "GET",
      `/machines/${machine.id}/wait?state=started&timeout=60`,
      undefined,
      AbortSignal.timeout(70_000),
    );
    return machine;
  }

  async exec(id: string, command: readonly string[], signal?: AbortSignal): Promise<ExecResult> {
    const started = Date.now();
    const timeout = AbortSignal.timeout((EXEC_TIMEOUT_SECONDS + 10) * 1000);
    const result = await this.call<{ exit_code?: number; stdout?: string; stderr?: string }>(
      "POST",
      `/machines/${id}/exec`,
      { command, timeout: EXEC_TIMEOUT_SECONDS },
      signal ? AbortSignal.any([signal, timeout]) : timeout,
    );
    return {
      exitCode: result.exit_code ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      seconds: Math.max(1, Math.ceil((Date.now() - started) / 1000)),
    };
  }

  async destroy(id: string): Promise<void> {
    await this.call("DELETE", `/machines/${id}?force=true`, undefined, undefined, [404]);
  }

  /** Every sandbox machine in the app. */
  async list(): Promise<readonly FlyMachine[]> {
    return this.call<FlyMachine[]>("GET", `/machines?metadata.djl_role=${SANDBOX_ROLE}`);
  }

  private async call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    signal: AbortSignal = AbortSignal.timeout(30_000),
    okStatuses: readonly number[] = [],
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/apps/${this.config.app}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (!response.ok && !okStatuses.includes(response.status))
      throw new Error(`fly machines ${method} ${path.split("?")[0]}: ${response.status}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** Destroys sandbox machines older than REAP_AFTER_MS; returns how many. */
export async function reapSandboxes(
  machines: Pick<FlyMachines, "list" | "destroy">,
  now: Date = new Date(),
): Promise<number> {
  let destroyed = 0;
  for (const machine of await machines.list()) {
    if (machine.config?.metadata?.djl_role !== SANDBOX_ROLE) continue;
    if (now.getTime() - Date.parse(machine.created_at) < REAP_AFTER_MS) continue;
    await machines.destroy(machine.id);
    destroyed += 1;
  }
  return destroyed;
}

export const SERVER_TARGETS = [
  "api",
  "worker",
  "admin",
  "web",
  "postgres",
  "redis",
  "s3",
  "operations-gateway",
  "codex-broker",
] as const;
export type ServerTarget = (typeof SERVER_TARGETS)[number];
export const SERVER_ACTIONS = [
  "restart",
  "backup",
  "deploy",
  "rollback",
  "reboot",
  "acknowledge",
] as const;
export type ServerAction = (typeof SERVER_ACTIONS)[number];
export interface ServerOperation {
  requestId: string;
  action: ServerAction;
  target: string;
  releaseId?: string;
  confirmation: string;
  reason: string;
}
export function operationConfirmation(action: ServerAction, target: string): string {
  if (action === "backup") return "BACK UP DJL";
  if (action === "reboot") return "REBOOT VPS";
  if (action === "acknowledge") return "ACKNOWLEDGE ALERT";
  return `${action === "rollback" ? "ROLL BACK" : action.toUpperCase()} ${target.toUpperCase()}`;
}
export function validateServerOperation(raw: unknown): ServerOperation {
  if (!raw || typeof raw !== "object") throw new Error("Operation is required.");
  const b = raw as Record<string, unknown>;
  if (
    typeof b.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId)
  )
    throw new Error("A valid request ID is required.");
  if (!SERVER_ACTIONS.includes(b.action as ServerAction))
    throw new Error("Choose a supported operation.");
  const action = b.action as ServerAction;
  if (typeof b.target !== "string") throw new Error("A target is required.");
  const target = b.target;
  if (action === "backup" || action === "reboot") {
    if (target !== "vps") throw new Error("This operation targets the VPS.");
  } else if (action === "acknowledge") {
    if (!/^[0-9a-f-]{36}$/i.test(target)) throw new Error("Choose a current alert.");
  } else {
    if (!SERVER_TARGETS.includes(target as ServerTarget)) throw new Error("Choose a DJL service.");
    if (
      (action === "deploy" || action === "rollback") &&
      !["api", "worker", "admin", "web"].includes(target)
    )
      throw new Error("Database and storage images cannot be deployed here.");
  }
  if (
    (action === "deploy" || action === "rollback") &&
    (typeof b.releaseId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(b.releaseId))
  )
    throw new Error("Choose a verified release.");
  if (b.confirmation !== operationConfirmation(action, target))
    throw new Error("Type the confirmation exactly as shown.");
  if (typeof b.reason !== "string" || b.reason.trim().length < 3 || b.reason.length > 500)
    throw new Error("Enter a reason between 3 and 500 characters.");
  return {
    requestId: b.requestId,
    action,
    target,
    confirmation: b.confirmation,
    reason: b.reason.trim(),
    ...(typeof b.releaseId === "string" ? { releaseId: b.releaseId } : {}),
  };
}

export interface ServerSample {
  at: number;
  cpu: number | null;
  memoryUsed: number;
  memoryTotal: number;
  swapUsed: number;
  swapTotal: number;
  diskUsed: number;
  diskTotal: number;
  receiveRate: number;
  transmitRate: number;
  diskReadRate: number;
  diskWriteRate: number;
  uptime: number;
  load: number[];
}
export interface ServerContainer {
  service: ServerTarget;
  state: string;
  health: string;
  cpu: number;
  memoryUsed: number;
  memoryLimit: number;
  restarts: number;
  image: string;
}
export interface ServerJob {
  id: string;
  action: ServerAction;
  target: string;
  status: "queued" | "running" | "succeeded" | "failed" | "scheduled";
  createdAt: number;
  finishedAt: number | null;
  message: string;
}
export interface ServerOverview {
  canControl: boolean;
  host: string;
  sampledAt: number;
  latest: ServerSample | null;
  history: ServerSample[];
  services: ServerContainer[];
  alerts: {
    id: string;
    severity: "warning" | "critical";
    title: string;
    openedAt: number;
    acknowledgedAt: number | null;
  }[];
  jobs: ServerJob[];
  backups: { id: string; createdAt: number; bytes: number; database: boolean; files: boolean }[];
  releases: {
    id: string;
    service: string;
    label: string;
    image: string;
    current: boolean;
    checks: number;
  }[];
  traffic: {
    requests: number;
    errors: number;
    averageLatencyMs: number;
    history: { at: number; requests: number; errors: number; averageLatencyMs: number }[];
  } | null;
}

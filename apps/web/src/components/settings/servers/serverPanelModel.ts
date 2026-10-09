// FILE: serverPanelModel.ts
// Purpose: Pure helpers for the Servers settings panel: form mapping, validation, command preview, formatting, status.
// Layer: Web settings model (no React, no i18n)
// Depends on: @synara/contracts server types

import type {
  ServerAuthMethod,
  ServerCreateInput,
  ServerId,
  ServerPermissionTier,
  ServerRecord,
  ServerSecretKind,
  ServerStats,
  ServerTestOutcome,
  ServerUpdateInput,
} from "@synara/contracts";

export type ServerFormAuthType = ServerAuthMethod["type"];

export interface ServerFormValues {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: ServerFormAuthType;
  keyPath: string;
  passphrase: string;
  keepPassphrase: boolean;
  privateKey: string;
  keepPrivateKey: boolean;
  password: string;
  keepPassword: boolean;
  tags: string[];
  permissionTier: ServerPermissionTier;
  notes: string;
}

/** Values are i18n key suffixes under `settings.servers.errors`. */
export type ServerFormErrors = Partial<
  Record<
    "name" | "host" | "port" | "username" | "keyPath" | "privateKey" | "password" | "tags",
    string
  >
>;

export const emptyServerForm = (): ServerFormValues => ({
  name: "",
  host: "",
  port: "22",
  username: "",
  authType: "agent",
  keyPath: "",
  passphrase: "",
  keepPassphrase: false,
  privateKey: "",
  keepPrivateKey: false,
  password: "",
  keepPassword: false,
  tags: [],
  permissionTier: "read-only",
  notes: "",
});

export function formFromRecord(record: ServerRecord): ServerFormValues {
  const { auth } = record;
  return {
    ...emptyServerForm(),
    name: record.name,
    host: record.host,
    port: String(record.port),
    username: record.username,
    authType: auth.type,
    keyPath: auth.type === "keyPath" ? auth.path : "",
    keepPassphrase: (auth.type === "keyPath" || auth.type === "importedKey") && auth.hasPassphrase,
    keepPrivateKey: auth.type === "importedKey",
    keepPassword: auth.type === "password",
    tags: [...record.tags],
    permissionTier: record.permissionTier,
    notes: record.notes,
  };
}

const HOSTNAME =
  /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.?$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const BRACKETED_IPV6 = /^\[[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*\]$/;
const TAG = /^[\p{L}\p{N}_-]{1,32}$/u;

function isValidHost(host: string): boolean {
  if (host.length > 253 || host.startsWith("-") || /\s/.test(host)) return false;
  return HOSTNAME.test(host) || IPV4.test(host) || BRACKETED_IPV6.test(host);
}

function parsePort(port: string): number | null {
  if (!/^\d{1,5}$/.test(port)) return null;
  const value = Number(port);
  return value >= 1 && value <= 65535 ? value : null;
}

export function validateServerForm(
  values: ServerFormValues,
  mode: "create" | "edit",
): ServerFormErrors {
  const errors: ServerFormErrors = {};
  const canKeep = mode === "edit";

  if (values.name.trim() === "") errors.name = "nameRequired";

  const host = values.host.trim();
  if (host === "") errors.host = "hostRequired";
  else if (!isValidHost(host)) errors.host = "hostInvalid";

  if (parsePort(values.port) === null) errors.port = "portInvalid";

  const username = values.username.trim();
  if (username === "" || username.startsWith("-") || /[\s@]/.test(username)) {
    errors.username = "usernameRequired";
  }

  switch (values.authType) {
    case "keyPath":
      if (values.keyPath.trim() === "") errors.keyPath = "keyPathRequired";
      break;
    case "importedKey":
      if (values.privateKey.trim() === "") {
        if (!(canKeep && values.keepPrivateKey)) errors.privateKey = "keyRequired";
      } else if (detectPrivateKeyType(values.privateKey) === null) {
        errors.privateKey = "keyInvalid";
      }
      break;
    case "password":
      if (values.password === "" && !(canKeep && values.keepPassword)) {
        errors.password = "passwordRequired";
      }
      break;
    case "agent":
      break;
  }

  if (values.tags.some((tag) => !TAG.test(tag))) errors.tags = "tagInvalid";

  return errors;
}

function buildAuth(values: ServerFormValues, hasPassphrase: boolean): ServerAuthMethod {
  switch (values.authType) {
    case "agent":
      return { type: "agent" };
    case "keyPath":
      return { type: "keyPath", path: values.keyPath.trim(), hasPassphrase };
    case "importedKey":
      return { type: "importedKey", hasPassphrase };
    case "password":
      return { type: "password" };
  }
}

function secretKindsFor(authType: ServerFormAuthType): ReadonlyArray<ServerSecretKind> {
  switch (authType) {
    case "agent":
      return [];
    case "keyPath":
      return ["passphrase"];
    case "importedKey":
      return ["privateKey", "passphrase"];
    case "password":
      return ["password"];
  }
}

/** Secret kinds the saved record currently holds, inferred from its auth method. */
function storedSecretKinds(auth: ServerAuthMethod): ReadonlyArray<ServerSecretKind> {
  switch (auth.type) {
    case "agent":
      return [];
    case "keyPath":
      return auth.hasPassphrase ? ["passphrase"] : [];
    case "importedKey":
      return auth.hasPassphrase ? ["privateKey", "passphrase"] : ["privateKey"];
    case "password":
      return ["password"];
  }
}

const KEEP_FLAG: Record<ServerSecretKind, keyof ServerFormValues> = {
  privateKey: "keepPrivateKey",
  passphrase: "keepPassphrase",
  password: "keepPassword",
};

function providedSecrets(values: ServerFormValues): Partial<Record<ServerSecretKind, string>> {
  const secret: Partial<Record<ServerSecretKind, string>> = {};
  for (const kind of secretKindsFor(values.authType)) {
    if (values[kind] !== "") secret[kind] = values[kind];
  }
  return secret;
}

export function toCreateInput(values: ServerFormValues): ServerCreateInput {
  const secret = providedSecrets(values);
  return {
    name: values.name.trim(),
    host: values.host.trim(),
    port: parsePort(values.port) ?? 22,
    username: values.username.trim(),
    auth: buildAuth(values, values.passphrase !== ""),
    tags: [...values.tags],
    permissionTier: values.permissionTier,
    notes: values.notes,
    ...(Object.keys(secret).length > 0 ? { secret } : {}),
  };
}

type ServerUpdatePatch = {
  -readonly [K in keyof ServerUpdateInput["patch"]]: ServerUpdateInput["patch"][K];
};

function sameAuth(a: ServerAuthMethod, b: ServerAuthMethod): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "keyPath" && b.type === "keyPath") {
    return a.path === b.path && a.hasPassphrase === b.hasPassphrase;
  }
  if (a.type === "importedKey" && b.type === "importedKey") {
    return a.hasPassphrase === b.hasPassphrase;
  }
  return true;
}

function sameTags(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

export function toUpdateInput(
  id: ServerId,
  values: ServerFormValues,
  previous: ServerRecord,
): ServerUpdateInput {
  const secret = providedSecrets(values);
  const stored = storedSecretKinds(previous.auth);
  const relevant = secretKindsFor(values.authType);
  const keeps = (kind: ServerSecretKind): boolean =>
    relevant.includes(kind) && stored.includes(kind) && values[KEEP_FLAG[kind]] === true;
  const clearSecrets = stored.filter((kind) => secret[kind] === undefined && !keeps(kind));

  const hasPassphrase = secret.passphrase !== undefined || keeps("passphrase");
  const auth = buildAuth(values, hasPassphrase);

  const patch: ServerUpdatePatch = {};
  const name = values.name.trim();
  const host = values.host.trim();
  const port = parsePort(values.port) ?? previous.port;
  const username = values.username.trim();
  if (name !== previous.name) patch.name = name;
  if (host !== previous.host) patch.host = host;
  if (port !== previous.port) patch.port = port;
  if (username !== previous.username) patch.username = username;
  if (!sameAuth(auth, previous.auth)) patch.auth = auth;
  if (!sameTags(values.tags, previous.tags)) patch.tags = [...values.tags];
  if (values.permissionTier !== previous.permissionTier)
    patch.permissionTier = values.permissionTier;
  if (values.notes !== previous.notes) patch.notes = values.notes;

  return {
    id,
    patch,
    ...(Object.keys(secret).length > 0 ? { secret } : {}),
    ...(clearSecrets.length > 0 ? { clearSecrets } : {}),
  };
}

const MASK = "••••••";

export function previewSshCommand(values: ServerFormValues): string {
  const parts = ["ssh", "-p", values.port.trim() || "22"];
  if (values.authType === "keyPath") parts.push("-i", values.keyPath.trim() || "<key>");
  if (values.authType === "importedKey") parts.push("-i", MASK);
  parts.push(`${values.username.trim() || "user"}@${values.host.trim() || "host"}`);

  const usesPassphrase =
    (values.authType === "keyPath" || values.authType === "importedKey") &&
    (values.passphrase !== "" || values.keepPassphrase);
  const command = parts.join(" ");
  if (values.authType === "password") return `${command}  # password via askpass`;
  if (usesPassphrase) return `${command}  # passphrase via askpass`;
  return command;
}

const KEY_HEADERS: ReadonlyArray<[RegExp, string]> = [
  [/^-----BEGIN OPENSSH PRIVATE KEY-----/, "OpenSSH"],
  [/^-----BEGIN RSA PRIVATE KEY-----/, "RSA"],
  [/^-----BEGIN EC PRIVATE KEY-----/, "EC"],
  [/^-----BEGIN (ENCRYPTED )?PRIVATE KEY-----/, "PKCS#8"],
];

export function detectPrivateKeyType(pem: string): string | null {
  const head = pem.trimStart();
  for (const [pattern, type] of KEY_HEADERS) {
    if (pattern.test(head)) return type;
  }
  return null;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${BYTE_UNITS[unit]}`;
}

export function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

export function uptimeParts(seconds: number): { days: number; hours: number; minutes: number } {
  const total = Math.max(0, Math.floor(seconds));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
  };
}

const STATS_STALE_AFTER_MS = 10 * 60_000;

export function isStatsStale(stats: ServerStats | undefined, now: number): boolean {
  return stats === undefined || now - stats.collectedAt > STATS_STALE_AFTER_MS;
}

const OUTCOME_STATUS_KEY: Record<ServerTestOutcome, string> = {
  ok: "ok",
  "host-key-unknown": "hostKeyUnknown",
  "host-key-changed": "hostKeyChanged",
  "auth-failed": "authFailed",
  unreachable: "unreachable",
  timeout: "timeout",
  "askpass-unsupported": "askpassUnsupported",
  error: "error",
};

/** Returns the i18n key suffix under `settings.servers.status`. */
export function statusKey(record: ServerRecord, pending: "test" | "refresh" | null): string {
  if (pending === "test") return "testing";
  if (pending === "refresh") return "refreshing";
  return record.lastTest ? OUTCOME_STATUS_KEY[record.lastTest.outcome] : "neverTested";
}

export function statusTone(record: ServerRecord): "neutral" | "success" | "warning" | "danger" {
  const outcome = record.lastTest?.outcome;
  if (outcome === undefined) return "neutral";
  if (outcome === "ok") return "success";
  if (outcome === "host-key-unknown") return "warning";
  return "danger";
}

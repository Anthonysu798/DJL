// FILE: agentLinks.ts
// Purpose: The desktop's side of lending an agent to someone else's Multi agents group. Each
//          link is a small process that connects to the other person's group through the relay
//          and answers with one of this computer's agents. Pure decisions; main.ts runs them.

import * as Path from "node:path";

import { isGroupLendableProvider, type DesktopAgentLink } from "@djl/contracts";

const LINK_ID_PATTERN = /^[a-z0-9]{8,32}$/;
const PAIRING_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
/** One process and one relay connection each. */
export const MAX_AGENT_LINKS = 8;

/** What is kept on disk for a link. Its keys live in its own state folder, not here. */
export interface AgentLinkRecord {
  readonly id: string;
  readonly provider: string;
  readonly model: string | null;
  readonly createdAt: number;
  readonly hostName: string | null;
  readonly groupName: string | null;
  readonly handle: string | null;
}

const text = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
};

/** Reads the saved links; anything malformed is dropped, since the id becomes a folder name. */
export function parseAgentLinkRecords(raw: unknown): AgentLinkRecord[] {
  if (!Array.isArray(raw)) return [];
  const records = new Map<string, AgentLinkRecord>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;
    const id = text(source.id, 32);
    const provider = text(source.provider, 40);
    if (!id || !LINK_ID_PATTERN.test(id) || !provider || !isGroupLendableProvider(provider))
      continue;
    records.set(id, {
      id,
      provider,
      model: text(source.model, 200),
      createdAt: typeof source.createdAt === "number" ? source.createdAt : 0,
      hostName: text(source.hostName, 200),
      groupName: text(source.groupName, 200),
      handle: text(source.handle, 80),
    });
    if (records.size >= MAX_AGENT_LINKS) break;
  }
  return [...records.values()];
}

/** The 10-character invite code, however the user typed it; null when it cannot be one. */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return PAIRING_CODE_PATTERN.test(code) ? code : null;
}

/** Checks a request to lend an agent. Returns the new record and its code, or why not. */
export function planAgentLink(input: {
  readonly request: unknown;
  readonly existing: number;
  readonly newId: () => string;
  readonly now: number;
}): { record: AgentLinkRecord; code: string } | { error: string } {
  const source =
    input.request && typeof input.request === "object"
      ? (input.request as Record<string, unknown>)
      : {};
  const code = normalizeInviteCode(source.code);
  if (!code) return { error: "Enter the 10-character invite code." };
  const provider = text(source.provider, 40);
  // Only agents that can run with no tools may answer another person's chat.
  if (!provider || !isGroupLendableProvider(provider)) return { error: "Choose an agent to lend." };
  if (input.existing >= MAX_AGENT_LINKS)
    return { error: `You can lend at most ${MAX_AGENT_LINKS} agents at a time.` };
  const id = input.newId();
  if (!LINK_ID_PATTERN.test(id)) return { error: "Could not create the link." };
  return {
    code,
    record: {
      id,
      provider,
      model: text(source.model, 200),
      createdAt: input.now,
      hostName: null,
      groupName: null,
      handle: null,
    },
  };
}

/** The folder with one link's identity and the host it trusts. Deleting it ends the link. */
export function agentLinkStateDir(baseDir: string, id: string): string {
  if (!LINK_ID_PATTERN.test(id)) throw new Error("Invalid link id.");
  return Path.join(baseDir, "agent-links", id);
}

export const agentLinksFile = (baseDir: string) => Path.join(baseDir, "agent-links", "links.json");

export function agentLinkEnv(input: {
  readonly base: NodeJS.ProcessEnv;
  readonly record: AgentLinkRecord;
  /** Only for the first start; afterwards the link reconnects with its saved identity. */
  readonly code: string | null;
  readonly baseDir: string;
  readonly relayUrl: string;
  readonly backendWsUrl: string;
}): NodeJS.ProcessEnv {
  const { DJL_AGENT_LINK_CODE: _code, DJL_AGENT_LINK_MODEL: _model, ...base } = input.base;
  return {
    ...base,
    ELECTRON_RUN_AS_NODE: "1",
    DJL_RELAY: input.relayUrl,
    DJL_ELECTRON_BACKEND_ENDPOINT: input.backendWsUrl,
    DJL_AGENT_LINK_ID: input.record.id,
    DJL_AGENT_LINK_PROVIDER: input.record.provider,
    DJL_AGENT_LINK_STATE_DIR: agentLinkStateDir(input.baseDir, input.record.id),
    ...(input.record.model ? { DJL_AGENT_LINK_MODEL: input.record.model } : {}),
    ...(input.code ? { DJL_AGENT_LINK_CODE: input.code } : {}),
    DJL_ELECTRON_BRIDGE_DIAGNOSTICS: "0",
  };
}

export function initialAgentLink(record: AgentLinkRecord): DesktopAgentLink {
  return {
    id: record.id,
    provider: record.provider,
    model: record.model,
    status: "connecting",
    hostName: record.hostName,
    groupName: record.groupName,
    handle: record.handle,
    busy: false,
    message: null,
    createdAt: record.createdAt,
  };
}

const STATUSES = new Set(["connecting", "connected", "offline", "refused"]);

/** Folds one status message from a link's process into what the renderer shows. */
export function reduceAgentLink(link: DesktopAgentLink, rawMessage: unknown): DesktopAgentLink {
  if (!rawMessage || typeof rawMessage !== "object") return link;
  const message = rawMessage as Record<string, unknown>;
  if (message.type !== "status" || !message.status || typeof message.status !== "object")
    return link;
  const status = message.status as Record<string, unknown>;
  if (typeof status.state !== "string" || !STATUSES.has(status.state)) return link;
  return {
    ...link,
    status: status.state as DesktopAgentLink["status"],
    hostName: text(status.hostName, 200) ?? link.hostName,
    groupName: text(status.groupName, 200) ?? link.groupName,
    handle: text(status.handle, 80) ?? link.handle,
    busy: status.busy === true,
    message: text(status.error, 300),
  };
}

/** The part of a link's live state worth keeping for the next launch. */
export function recordOf(record: AgentLinkRecord, link: DesktopAgentLink): AgentLinkRecord {
  return { ...record, hostName: link.hostName, groupName: link.groupName, handle: link.handle };
}

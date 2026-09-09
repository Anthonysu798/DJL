// FILE: serverMentionPrompt.ts
// Purpose: Resolves `@server` mentions against the registry and renders the
//          <selected_servers> prompt block every harness receives.
// Layer: Servers domain helpers
import {
  isServerMentionPath,
  type ProviderMentionReference,
  type ServerId,
  type ServerPermissionTier,
  type ServerRecord,
  serverIdFromMentionPath,
} from "@synara/contracts";
import { Effect, Option } from "effect";

const TIER_TEXT: Record<ServerPermissionTier, string> = {
  "read-only":
    "read-only (only inspection commands are allowed; anything that changes the server is refused)",
  "approve-each":
    "approve-each (the user approves every command before it runs; explain what a command does before running it)",
  full: "full (commands run without asking; prefer safe, reversible commands and state clearly what you changed)",
};

export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const singleLine = (value: string) => value.replace(/\s+/g, " ").trim();

function describeServer(server: ServerRecord): string {
  const fields = [
    `name: ${JSON.stringify(server.name)}`,
    `address: ${server.username}@${server.host}:${server.port}`,
    `permission: ${TIER_TEXT[server.permissionTier]}`,
  ];
  if (server.tags.length > 0) fields.push(`tags: ${server.tags.join(", ")}`);
  const stats = server.lastStats;
  if (stats?.os) fields.push(`system: ${stats.os}`);
  if (stats?.kernel) fields.push(`kernel: ${stats.kernel}`);
  if (stats?.uptimeSeconds !== undefined)
    fields.push(`uptime: ${formatUptime(stats.uptimeSeconds)}`);
  const notes = singleLine(server.notes);
  if (notes) fields.push(`notes: ${notes}`);
  return `- ${fields.join(", ")}`;
}

export function buildSelectedServersPromptBlock(servers: ReadonlyArray<ServerRecord>): string {
  const example = JSON.stringify(servers[0]?.name ?? "web-1");
  return [
    "<selected_servers>",
    "The user attached these registered SSH servers to this turn. To run a command on one, call the djl-ssh helper that is already on PATH, one command per call, never interactive programs:",
    '  djl-ssh "<server name>" <command>',
    `Examples: djl-ssh ${example} df -h ; djl-ssh ${example} systemctl status nginx`,
    "Output and the remote exit code are returned. Do not use plain ssh, scp, or store credentials; DJL handles authentication.",
    ...servers.map(describeServer),
    "</selected_servers>",
  ].join("\n");
}

export interface ResolvedServerMentions {
  readonly servers: ServerRecord[];
  readonly remainingMentions: ProviderMentionReference[];
}

/**
 * Splits `ssh://` references out of a mention list. Every server reference is
 * removed from `remainingMentions`, even when it no longer resolves, so no
 * harness ever sees a non-path native mention.
 */
export const resolveServerMentions = <E>(
  mentions: ReadonlyArray<ProviderMentionReference>,
  lookup: (id: ServerId) => Effect.Effect<Option.Option<ServerRecord>, E>,
): Effect.Effect<ResolvedServerMentions, E> =>
  Effect.gen(function* () {
    const servers: ServerRecord[] = [];
    const remainingMentions: ProviderMentionReference[] = [];
    const seen = new Set<string>();
    for (const mention of mentions) {
      if (!isServerMentionPath(mention.path)) {
        remainingMentions.push(mention);
        continue;
      }
      const id = serverIdFromMentionPath(mention.path);
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      const record = yield* lookup(id);
      if (Option.isSome(record)) servers.push(record.value);
    }
    return { servers, remainingMentions };
  });

export function appendSelectedServersBlock(
  text: string | undefined,
  servers: ReadonlyArray<ServerRecord>,
): string | undefined {
  if (servers.length === 0) return text;
  const block = buildSelectedServersPromptBlock(servers);
  return text ? `${text}\n\n${block}` : block;
}

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OrchestrationThread } from "@synara/contracts";
import { resolveAttachmentPathById } from "../attachmentStore";

type PriorHandoffArchive = {
  format: "djl-agent-context-v1";
  notes?: string;
  notesHistory?: string[];
  handoffHistory?: unknown[];
  memoryContext?: unknown[];
  attachmentFiles?: unknown[];
  activities?: unknown[];
  proposedPlans?: unknown[];
  checkpoints?: unknown[];
};
const PRIOR_ARCHIVE_ARRAY_FIELDS = [
  "notesHistory",
  "handoffHistory",
  "memoryContext",
  "attachmentFiles",
  "activities",
  "proposedPlans",
  "checkpoints",
] as const satisfies ReadonlyArray<keyof PriorHandoffArchive>;

function archivePath(stateDir: string, threadId: string): string {
  const name = createHash("sha256").update(threadId).digest("hex");
  return join(stateDir, "handoff-context", `${name}.json`);
}

function mergeUnique(items: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readPriorArchive(stateDir: string, threadId: string): Promise<PriorHandoffArchive> {
  const parsed: unknown = JSON.parse(await readFile(archivePath(stateDir, threadId), "utf8"));
  const record =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  if (
    record === null ||
    record.format !== "djl-agent-context-v1" ||
    (record.notes !== undefined && typeof record.notes !== "string") ||
    PRIOR_ARCHIVE_ARRAY_FIELDS.some(
      (field) => record[field] !== undefined && !Array.isArray(record[field]),
    )
  ) {
    throw new Error(`Invalid prior handoff context archive for thread '${threadId}'.`);
  }
  return record as PriorHandoffArchive;
}

/** A lossless, local reference for context that cannot fit in a provider prompt. */
export async function writeHandoffContextArchive(input: {
  stateDir: string;
  attachmentsDir?: string;
  thread: OrchestrationThread;
  sourceThread: OrchestrationThread | undefined;
}): Promise<string> {
  const directory = join(input.stateDir, "handoff-context");
  const path = archivePath(input.stateDir, input.thread.id);
  // Retries keep the original snapshot even if the source was changed or deleted.
  if (existsSync(path)) return path;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = input.sourceThread ?? input.thread;
  const prior: Partial<PriorHandoffArchive> = source.handoff
    ? await readPriorArchive(input.stateDir, source.id)
    : {};
  const messages = input.thread.messages.filter((message) => message.source === "handoff-import");
  const attachmentIds = [
    ...new Set(
      messages.flatMap((message) =>
        (message.attachments ?? [])
          .filter((attachment) => attachment.type !== "assistant-selection")
          .map((attachment) => attachment.id),
      ),
    ),
  ];
  const sourceMemoryContext = (source.messages ?? []).flatMap((message) =>
    message.memoryContext ? [message.memoryContext] : [],
  );
  const attachmentFiles = attachmentIds.map((id) => ({
    id,
    path:
      input.attachmentsDir && existsSync(input.attachmentsDir)
        ? resolveAttachmentPathById({ attachmentsDir: input.attachmentsDir, attachmentId: id })
        : null,
  }));
  const notesHistory = mergeUnique(
    [...(prior.notesHistory ?? []), prior.notes, source.notes].filter(
      (note): note is string => typeof note === "string" && note.length > 0,
    ),
  );
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      JSON.stringify(
        {
          format: "djl-agent-context-v1",
          title: source.title,
          sourceThreadId: source.id,
          previousHandoff: source.handoff,
          handoffHistory: mergeUnique([
            ...(prior.handoffHistory ?? []),
            ...(source.handoff ? [source.handoff] : []),
          ]),
          projectId: source.projectId,
          branch: source.branch,
          worktreePath: source.worktreePath,
          notes: source.notes ?? prior.notes ?? "",
          notesHistory,
          messages,
          memoryContext: mergeUnique([...(prior.memoryContext ?? []), ...sourceMemoryContext]),
          attachmentFiles: mergeUnique([...(prior.attachmentFiles ?? []), ...attachmentFiles]),
          activities: mergeUnique([...(prior.activities ?? []), ...(source.activities ?? [])]),
          proposedPlans: mergeUnique([
            ...(prior.proposedPlans ?? []),
            ...(source.proposedPlans ?? []),
          ]),
          latestTurn: source.latestTurn,
          workTask: source.workTask ?? null,
          checkpoints: mergeUnique([...(prior.checkpoints ?? []), ...(source.checkpoints ?? [])]),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return path;
}

export async function removeHandoffContextArchive(input: {
  stateDir: string;
  threadId: string;
}): Promise<void> {
  await rm(archivePath(input.stateDir, input.threadId), { force: true });
}

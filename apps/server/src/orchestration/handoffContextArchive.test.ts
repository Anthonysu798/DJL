import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OrchestrationThread } from "@synara/contracts";
import { expect, it } from "vitest";
import { removeHandoffContextArchive, writeHandoffContextArchive } from "./handoffContextArchive";

it("saves full context and references without including the destination's new request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-context-test-"));
  try {
    const imported = {
      source: "handoff-import",
      text: "Detailed requirement. ".repeat(10_000),
      skills: [{ name: "review", path: "/project/SKILL.md" }],
    };
    const source = {
      messages: [],
      id: "source",
      title: "Task",
      notes: "Keep the existing workflow",
      activities: [{ summary: "Test output" }],
      proposedPlans: [{ planMarkdown: "Remaining steps" }],
    };
    const path = await writeHandoffContextArchive({
      stateDir: directory,
      thread: {
        id: "../../destination",
        messages: [imported, { source: "native", text: "New request" }],
      } as unknown as OrchestrationThread,
      sourceThread: source as unknown as OrchestrationThread,
    });
    expect(path.startsWith(join(directory, "handoff-context"))).toBe(true);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.messages).toEqual([imported]);
    expect(saved.notes).toBe(source.notes);
    expect(saved.activities).toEqual(source.activities);
    expect(saved.proposedPlans).toEqual(source.proposedPlans);
    expect(saved).not.toHaveProperty("previousContextArchivePath");
    await writeHandoffContextArchive({
      stateDir: directory,
      thread: { id: "../../destination", messages: [] } as unknown as OrchestrationThread,
      sourceThread: undefined,
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(saved);

    const secondPath = await writeHandoffContextArchive({
      stateDir: directory,
      thread: {
        id: "second-destination",
        messages: [{ ...imported, text: "First and second handoff transcript" }],
      } as unknown as OrchestrationThread,
      sourceThread: {
        ...source,
        id: "../../destination",
        handoff: { sourceThreadId: "source" },
        notes: "Second handoff note",
        activities: [{ summary: "Second activity" }],
        proposedPlans: [{ planMarkdown: "Second plan" }],
      } as unknown as OrchestrationThread,
    });
    const second = JSON.parse(await readFile(secondPath, "utf8"));
    expect(second.notesHistory).toEqual(["Keep the existing workflow", "Second handoff note"]);
    expect(second.activities).toEqual([{ summary: "Test output" }, { summary: "Second activity" }]);
    expect(second.proposedPlans).toEqual([
      { planMarkdown: "Remaining steps" },
      { planMarkdown: "Second plan" },
    ]);

    await removeHandoffContextArchive({ stateDir: directory, threadId: "../../destination" });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await removeHandoffContextArchive({ stateDir: directory, threadId: "second-destination" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("fails closed when a repeated handoff cannot read its prior archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-context-corrupt-test-"));
  try {
    const priorPath = await writeHandoffContextArchive({
      stateDir: directory,
      thread: {
        id: "prior-destination",
        messages: [],
      } as unknown as OrchestrationThread,
      sourceThread: {
        id: "source",
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
      } as unknown as OrchestrationThread,
    });
    await writeFile(priorPath, "{malformed", "utf8");

    await expect(
      writeHandoffContextArchive({
        stateDir: directory,
        thread: { id: "next-destination", messages: [] } as unknown as OrchestrationThread,
        sourceThread: {
          id: "prior-destination",
          handoff: { sourceThreadId: "source" },
          messages: [],
          activities: [],
          proposedPlans: [],
          checkpoints: [],
        } as unknown as OrchestrationThread,
      }),
    ).rejects.toThrow();

    await writeFile(
      priorPath,
      JSON.stringify({ format: "djl-agent-context-v1", activities: "oops" }),
      "utf8",
    );
    await expect(
      writeHandoffContextArchive({
        stateDir: directory,
        thread: { id: "next-destination", messages: [] } as unknown as OrchestrationThread,
        sourceThread: {
          id: "prior-destination",
          handoff: { sourceThreadId: "source" },
          messages: [],
          activities: [],
          proposedPlans: [],
          checkpoints: [],
        } as unknown as OrchestrationThread,
      }),
    ).rejects.toThrow("Invalid prior handoff context archive");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

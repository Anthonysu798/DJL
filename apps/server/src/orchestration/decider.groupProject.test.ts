import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadId,
} from "@djl/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const root = "/tmp/group-shared-root";

async function readModelWithBusyProject(kind: "project" | "group") {
  const now = new Date().toISOString();
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: EventId.makeUnsafe("evt-existing-project"),
      aggregateKind: "project",
      aggregateId: ProjectId.makeUnsafe("project-existing"),
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-existing-project"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("cmd-existing-project"),
      metadata: {},
      payload: {
        projectId: ProjectId.makeUnsafe("project-existing"),
        kind,
        title: "Existing",
        workspaceRoot: root,
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: EventId.makeUnsafe("evt-existing-thread"),
      aggregateKind: "thread",
      aggregateId: ThreadId.makeUnsafe("thread-existing"),
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-existing-thread"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("cmd-existing-thread"),
      metadata: {},
      payload: {
        threadId: ThreadId.makeUnsafe("thread-existing"),
        projectId: ProjectId.makeUnsafe("project-existing"),
        title: "Saved chat",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        handoff: null,
        envMode: "local",
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

const createCommand = (kind: "project" | "group") => ({
  type: "project.create" as const,
  commandId: CommandId.makeUnsafe(`cmd-new-${kind}`),
  projectId: ProjectId.makeUnsafe(`project-new-${kind}`),
  kind,
  title: "New",
  workspaceRoot: root,
  createWorkspaceRootIfMissing: false,
  isPinned: false,
  createdAt: new Date().toISOString(),
});

describe("group projects share folders without owning them", () => {
  it("a group project may use a folder that a project with chats already uses", async () => {
    const readModel = await readModelWithBusyProject("project");
    const events = await Effect.runPromise(
      decideOrchestrationCommand({ command: createCommand("group"), readModel }),
    );
    const list = [events].flat();
    expect(list.some((event) => event.type === "project.created")).toBe(true);
    expect(list.some((event) => event.type === "project.deleted")).toBe(false);
  });
  it("a group project does not block adding the same folder as a normal project", async () => {
    const readModel = await readModelWithBusyProject("group");
    const events = await Effect.runPromise(
      decideOrchestrationCommand({ command: createCommand("project"), readModel }),
    );
    const list = [events].flat();
    expect(list.some((event) => event.type === "project.created")).toBe(true);
    expect(list.some((event) => event.type === "project.deleted")).toBe(false);
  });
});

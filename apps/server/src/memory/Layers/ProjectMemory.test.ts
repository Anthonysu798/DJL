import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { readdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ServerConfig } from "../../config.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { ProjectMemory } from "../Services/ProjectMemory.ts";
import { ProjectMemoryLive } from "./ProjectMemory.ts";

const projectA = ProjectId.makeUnsafe("project-a");
const projectB = ProjectId.makeUnsafe("project-b");
const threadA = ThreadId.makeUnsafe("thread-a");

function testLayer() {
  const database = NodeSqliteClient.layerMemory();
  const config = ServerConfig.layerTest(process.cwd(), { prefix: "djl-memory-test-" });
  const memory = ProjectMemoryLive.pipe(Layer.provideMerge(database), Layer.provideMerge(config));
  return Layer.mergeAll(database, config, memory).pipe(Layer.provideMerge(NodeServices.layer));
}

describe("ProjectMemoryLive", () => {
  it("keeps an Obsidian-compatible vault outside project folders and isolates retrieval", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const memory = yield* ProjectMemory;
        const root = yield* memory.ensureProject({
          projectId: projectA,
          title: "Launch planning",
          createdAt: "2026-07-13T10:00:00.000Z",
        });
        expect(root).toBe(path.join(memory.vaultRoot, "Studio", "Projects", "project-a"));

        const projectMarkdown = yield* Effect.promise(() =>
          readFile(path.join(root, "Project.md"), "utf8"),
        );
        expect(projectMarkdown).toContain('project_id: "project-a"');
        expect(projectMarkdown).toContain("# Launch planning");
        expect(yield* Effect.promise(() => readdir(root))).toEqual(
          expect.arrayContaining([
            "Attachments",
            "Decisions",
            "People",
            "Project.md",
            "Sources",
            "Tasks",
          ]),
        );

        yield* memory.recordTurn({
          projectId: projectA,
          projectTitle: "Launch planning",
          projectCreatedAt: "2026-07-13T10:00:00.000Z",
          threadId: threadA,
          threadTitle: "Choose launch date",
          turnId: TurnId.makeUnsafe("turn-a"),
          userText: "Set the launch date and remember it.",
          assistantText: "Decision: The launch date is September 9.",
          completedAt: "2026-07-13T10:05:00.000Z",
        });

        const sameProject = yield* memory.retrieve({
          projectId: projectA,
          threadId: threadA,
          query: "When is the launch date?",
        });
        expect(sameProject.brief).toContain("September 9");
        expect(sameProject.brief).toContain("[[Tasks/thread-a]]");

        yield* memory.ensureProject({
          projectId: projectB,
          title: "Private second project",
          createdAt: "2026-07-13T10:00:00.000Z",
        });
        const otherProject = yield* memory.retrieve({
          projectId: projectB,
          threadId: ThreadId.makeUnsafe("thread-b"),
          query: "September launch date",
        });
        expect(otherProject.brief).not.toContain("September 9");
      }).pipe(Effect.provide(testLayer())),
    );
  });

  it("reindexes manual Obsidian edits and removes deleted or unrelated results", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const memory = yield* ProjectMemory;
        const root = yield* memory.ensureProject({
          projectId: projectA,
          title: "Editable project",
          createdAt: "2026-07-13T10:00:00.000Z",
        });
        const notePath = path.join(root, "Sources", "Manual.md");
        yield* Effect.promise(() =>
          writeFile(
            notePath,
            `---\ndjl_schema: 1\ntype: "source"\nproject_id: "project-a"\nimportance: 0.8\nconfidence: 1\n---\n# Manual note\nThe customer code is ORCHID-77.\n`,
            "utf8",
          ),
        );
        yield* memory.reindexProject(projectA);
        expect(
          (yield* memory.retrieve({ projectId: projectA, threadId: threadA, query: "ORCHID-77" }))
            .brief,
        ).toContain("ORCHID-77");

        yield* Effect.promise(() =>
          writeFile(
            notePath,
            `---\ndjl_schema: 1\ntype: "source"\nproject_id: "project-a"\n---\n# Manual note\nThe customer code is LANTERN-12.\n`,
            "utf8",
          ),
        );
        yield* memory.reindexProject(projectA);
        const updated = yield* memory.retrieve({
          projectId: projectA,
          threadId: threadA,
          query: "customer code LANTERN",
        });
        expect(updated.brief).toContain("LANTERN-12");
        expect(updated.brief).not.toContain("ORCHID-77");

        yield* Effect.promise(() => unlink(notePath));
        const outsidePath = path.join(root, "..", "outside-project.md");
        yield* Effect.promise(() =>
          writeFile(outsidePath, "# Outside\nThis secret is SYMLINK-ESCAPE-99.\n", "utf8"),
        );
        yield* Effect.promise(() =>
          symlink(outsidePath, path.join(root, "Sources", "Unsafe-link.md")),
        );
        yield* memory.reindexProject(projectA);
        const afterDeletion = yield* memory.retrieve({
          projectId: projectA,
          threadId: threadA,
          query: "customer code LANTERN SYMLINK-ESCAPE",
        });
        expect(afterDeletion.brief).not.toContain("LANTERN-12");
        expect(afterDeletion.brief).not.toContain("SYMLINK-ESCAPE-99");
      }).pipe(Effect.provide(testLayer())),
    );
  });

  it("preserves a concurrent manual edit and writes a conflict copy", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const memory = yield* ProjectMemory;
        const input = {
          projectId: projectA,
          projectTitle: "Conflict project",
          projectCreatedAt: "2026-07-13T10:00:00.000Z",
          threadId: threadA,
          threadTitle: "Conflict task",
          turnId: TurnId.makeUnsafe("turn-a"),
          userText: "Initial request",
          assistantText: "Initial answer",
          completedAt: "2026-07-13T10:01:00.000Z",
        } as const;
        const first = yield* memory.recordTurn(input);
        const firstMarkdown = yield* Effect.promise(() => readFile(first.path, "utf8"));
        yield* Effect.promise(() =>
          writeFile(first.path, `${firstMarkdown}\nManual Obsidian edit.\n`, "utf8"),
        );

        const second = yield* memory.recordTurn({
          ...input,
          turnId: TurnId.makeUnsafe("turn-b"),
          userText: "Follow-up request",
          assistantText: "Follow-up answer",
          completedAt: "2026-07-13T10:02:00.000Z",
        });
        expect(second.conflictPath).not.toBeNull();
        expect(yield* Effect.promise(() => readFile(first.path, "utf8"))).toContain(
          "Manual Obsidian edit",
        );
        expect(yield* Effect.promise(() => readFile(second.conflictPath!, "utf8"))).toContain(
          "Follow-up answer",
        );
      }).pipe(Effect.provide(testLayer())),
    );
  });

  it("records a provider turn idempotently", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const memory = yield* ProjectMemory;
        const input = {
          projectId: projectA,
          projectTitle: "Idempotent project",
          projectCreatedAt: "2026-07-13T10:00:00.000Z",
          threadId: threadA,
          threadTitle: "Idempotent task",
          turnId: TurnId.makeUnsafe("turn-stable"),
          userText: "Remember the stable answer.",
          assistantText: "The stable answer is twelve.",
          completedAt: "2026-07-13T10:01:00.000Z",
        } as const;

        const first = yield* memory.recordTurn(input);
        const second = yield* memory.recordTurn(input);
        const markdown = yield* Effect.promise(() => readFile(first.path, "utf8"));

        expect(second.conflictPath).toBeNull();
        expect(markdown.match(/\{#turn-turn-stable\}/g)).toHaveLength(1);
        expect(markdown.match(/The stable answer is twelve\./g)).toHaveLength(1);
      }).pipe(Effect.provide(testLayer())),
    );
  });
});

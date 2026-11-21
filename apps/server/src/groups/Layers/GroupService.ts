// FILE: GroupService.ts
// Purpose: Multi agents groups: creates the group's folder, project and thread, manages
//          members and pauses, and publishes live group events to the renderer.
// Layer: Service implementation

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  GROUP_DEFAULT_HOP_LIMIT,
  GROUP_MODEL_SELECTION,
  GroupId,
  GroupMemberId,
  MessageId,
  PROVIDER_DISPLAY_NAMES,
  ProjectId,
  ThreadId,
  type Group,
  type GroupEvent,
  type GroupLive,
  type GroupMember,
  type GroupMemberState,
  type OrchestrationCommand,
} from "@synara/contracts";
import { nextGroupHandle } from "@synara/shared/groupChat";
import { Effect, Layer, PubSub, Stream } from "effect";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { ServerConfig } from "../../config";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { GroupRepository } from "../../persistence/Services/GroupRepository.ts";
import type { GroupRuntime } from "../../harnesses/native/group/groupRound";
import {
  discoverSkillsCatalog,
  filterDisabledSkills,
  skillsCatalogRoots,
} from "../../provider/skillsCatalog";
import { ServerSettingsService } from "../../serverSettings";
import { GroupDriverBridge } from "../Services/GroupDriverBridge";
import {
  GroupService,
  GroupServiceError,
  type GroupLiveControls,
  type GroupServiceShape,
} from "../Services/GroupService";

// A runaway reply must not grow memory without bound; late joiners see its tail.
const LIVE_DRAFT_LIMIT = 24_000;

const fail = (message: string) => (cause: unknown) => new GroupServiceError({ message, cause });
const newId = () => randomUUID().replaceAll("-", "");

function gitInit(folder: string) {
  // A git folder gives each round the existing checkpoint diff; a missing git is not fatal.
  return new Promise<void>((resolve) => {
    execFile("git", ["init", "-q"], { cwd: folder, timeout: 10_000 }, () => resolve());
  });
}

const rowOf = (group: Group) => {
  const { members: _members, ...row } = group;
  return row;
};

const makeGroupService = Effect.gen(function* () {
  const repository = yield* GroupRepository;
  const engine = yield* OrchestrationEngineService;
  const config = yield* ServerConfig;
  const events = yield* PubSub.unbounded<GroupEvent>();
  const live = new Map<string, GroupLiveControls>();
  const liveStates = new Map<GroupMemberId, GroupMemberState>();
  const liveDrafts = new Map<GroupMemberId, string>();
  const settingsService = yield* ServerSettingsService;
  const bridge = yield* GroupDriverBridge;

  const publish: GroupServiceShape["publish"] = (event) =>
    PubSub.publish(events, event).pipe(Effect.asVoid);

  const dispatch = (command: OrchestrationCommand, message: string) =>
    engine.dispatch(command).pipe(Effect.mapError(fail(message)), Effect.asVoid);

  const load = (groupId: GroupId) =>
    repository.getById(groupId).pipe(
      Effect.mapError(fail("Failed to read the group")),
      Effect.flatMap((group) =>
        group
          ? Effect.succeed(group)
          : Effect.fail(new GroupServiceError({ message: "Group not found" })),
      ),
    );

  const changed = (groupId: GroupId) =>
    load(groupId).pipe(Effect.tap((group) => publish({ type: "group.upserted", group })));

  const saveMember = (member: GroupMember) =>
    repository.upsertMember(member).pipe(Effect.mapError(fail("Failed to save the member")));

  const callLive = (threadId: ThreadId, run: (controls: GroupLiveControls) => Promise<void>) =>
    Effect.tryPromise({
      try: async () => {
        const controls = live.get(threadId);
        if (controls) await run(controls);
      },
      catch: fail("The running group did not respond"),
    });

  const list: GroupServiceShape["list"] = () =>
    repository.listGroups().pipe(Effect.mapError(fail("Failed to list groups")));

  const listReplies: GroupServiceShape["listReplies"] = () =>
    repository.listReplies().pipe(Effect.mapError(fail("Failed to list group replies")));

  const liveNow = (): GroupLive => ({
    memberStates: Object.fromEntries(liveStates),
    drafts: Object.fromEntries(liveDrafts),
  });
  const forgetLive = (memberId: GroupMemberId) => {
    liveStates.delete(memberId);
    liveDrafts.delete(memberId);
  };

  const create: GroupServiceShape["create"] = (input) =>
    Effect.gen(function* () {
      const groupId = GroupId.makeUnsafe(newId());
      const threadId = ThreadId.makeUnsafe(newId());
      const projectId = ProjectId.makeUnsafe(newId());
      const folder = join(config.stateDir, "groups", groupId);
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(folder, { recursive: true });
          await gitInit(folder);
        },
        catch: fail("Failed to create the group folder"),
      });
      const now = Date.now();
      const createdAt = new Date(now).toISOString();
      yield* dispatch(
        {
          type: "project.create",
          commandId: CommandId.makeUnsafe(`group:${groupId}:project`),
          projectId,
          kind: "group",
          title: input.name,
          workspaceRoot: folder,
          createWorkspaceRootIfMissing: false,
          isPinned: false,
          createdAt,
        },
        "Failed to create the group project",
      );
      yield* dispatch(
        {
          type: "thread.create",
          commandId: CommandId.makeUnsafe(`group:${groupId}:thread`),
          threadId,
          projectId,
          title: input.name,
          modelSelection: GROUP_MODEL_SELECTION,
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          envMode: "local",
          branch: null,
          worktreePath: null,
          createBranchFlowCompleted: false,
          isPinned: false,
          parentThreadId: null,
          subagentAgentId: null,
          subagentNickname: null,
          subagentRole: null,
          lastKnownPr: null,
          createdAt,
        },
        "Failed to create the group chat",
      );
      yield* repository
        .upsertGroup({
          id: groupId,
          threadId,
          projectId,
          name: input.name,
          folder,
          folderIsAuto: true,
          hopLimit: GROUP_DEFAULT_HOP_LIMIT,
          skipAllWarning: false,
          pendingHandoffs: [],
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.mapError(fail("Failed to save the group")));
      const handles: string[] = [];
      for (const [position, member] of input.members.entries()) {
        const handle = nextGroupHandle(PROVIDER_DISPLAY_NAMES[member.provider], handles);
        handles.push(handle);
        yield* saveMember({
          id: GroupMemberId.makeUnsafe(newId()),
          groupId,
          provider: member.provider,
          handle,
          role: member.role ?? null,
          model: null,
          position,
        });
      }
      return yield* changed(groupId);
    });

  const update: GroupServiceShape["update"] = (input) =>
    Effect.gen(function* () {
      const group = yield* load(input.groupId);
      let next = { ...rowOf(group), updatedAt: Date.now() };
      if (input.name !== undefined) next = { ...next, name: input.name };
      if (input.hopLimit !== undefined) next = { ...next, hopLimit: input.hopLimit };
      if (input.skipAllWarning !== undefined)
        next = { ...next, skipAllWarning: input.skipAllWarning };
      const folder = input.folder;
      if (folder !== undefined && folder !== group.folder) {
        const isDirectory = yield* Effect.promise(() =>
          stat(folder).then(
            (entry) => entry.isDirectory(),
            () => false,
          ),
        );
        if (!isDirectory)
          return yield* new GroupServiceError({ message: `Folder not found: ${folder}` });
        yield* dispatch(
          {
            type: "project.meta.update",
            commandId: CommandId.makeUnsafe(`group:${group.id}:folder:${newId()}`),
            projectId: group.projectId,
            workspaceRoot: folder,
            createWorkspaceRootIfMissing: false,
          },
          "Failed to move the group folder",
        );
        next = { ...next, folder, folderIsAuto: false };
        yield* repository
          .resetMemberSessions(group.id)
          .pipe(Effect.mapError(fail("Failed to reset member sessions")));
        yield* callLive(group.threadId, (controls) => controls.resetSessions());
      }
      yield* repository.upsertGroup(next).pipe(Effect.mapError(fail("Failed to save the group")));
      return yield* changed(group.id);
    });

  const remove: GroupServiceShape["delete"] = ({ groupId }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      yield* dispatch(
        {
          type: "thread.delete",
          commandId: CommandId.makeUnsafe(`group:${groupId}:thread-delete`),
          threadId: group.threadId,
        },
        "Failed to delete the group chat",
      );
      yield* dispatch(
        {
          type: "project.delete",
          commandId: CommandId.makeUnsafe(`group:${groupId}:project-delete`),
          projectId: group.projectId,
        },
        "Failed to delete the group project",
      );
      yield* repository.deleteGroup(groupId).pipe(Effect.mapError(fail("Failed to delete group")));
      live.delete(group.threadId);
      for (const member of group.members) forgetLive(member.id);
      yield* publish({ type: "group.deleted", groupId, folder: group.folder });
      return { folder: group.folder };
    });

  const addMember: GroupServiceShape["addMember"] = (input) =>
    Effect.gen(function* () {
      const group = yield* load(input.groupId);
      yield* saveMember({
        id: GroupMemberId.makeUnsafe(newId()),
        groupId: group.id,
        provider: input.provider,
        handle: nextGroupHandle(
          PROVIDER_DISPLAY_NAMES[input.provider],
          group.members.map((member) => member.handle),
        ),
        role: input.role ?? null,
        model: null,
        position: Math.max(-1, ...group.members.map((member) => member.position)) + 1,
      });
      return yield* changed(group.id);
    });

  const updateMember: GroupServiceShape["updateMember"] = (input) =>
    Effect.gen(function* () {
      const group = yield* load(input.groupId);
      const member = group.members.find((entry) => entry.id === input.memberId);
      if (!member) return yield* new GroupServiceError({ message: "Member not found" });
      yield* saveMember({
        ...member,
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
      });
      return yield* changed(group.id);
    });

  const removeMember: GroupServiceShape["removeMember"] = ({ groupId, memberId }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      yield* callLive(group.threadId, (controls) => controls.removeMember(memberId));
      yield* repository
        .deleteMember(memberId)
        .pipe(Effect.mapError(fail("Failed to remove the member")));
      forgetLive(memberId);
      return yield* changed(groupId);
    });

  const stopMember: GroupServiceShape["stopMember"] = ({ groupId, memberId }) =>
    load(groupId).pipe(
      Effect.flatMap((group) =>
        callLive(group.threadId, (controls) => controls.stopMember(memberId)),
      ),
    );

  const savePause: GroupServiceShape["savePause"] = (groupId, handoffs) =>
    repository.setPause(groupId, handoffs, false).pipe(
      Effect.mapError(fail("Failed to save the pause")),
      Effect.flatMap(() => changed(groupId)),
      Effect.asVoid,
    );

  const takeResume: GroupServiceShape["takeResume"] = (groupId) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      const requested = yield* repository
        .isResumeRequested(groupId)
        .pipe(Effect.mapError(fail("Failed to read the pause")));
      if (group.pendingHandoffs.length === 0 && !requested) return [];
      yield* repository
        .setPause(groupId, [], false)
        .pipe(Effect.mapError(fail("Failed to clear the pause")));
      yield* changed(groupId);
      return requested ? group.pendingHandoffs : [];
    });

  const resolvePause: GroupServiceShape["resolvePause"] = (input) =>
    Effect.gen(function* () {
      const group = yield* load(input.groupId);
      if (input.action === "stop") {
        yield* repository
          .setPause(group.id, [], false)
          .pipe(Effect.mapError(fail("Failed to clear the pause")));
        yield* changed(group.id);
        return;
      }
      yield* repository
        .setPause(group.id, group.pendingHandoffs, true)
        .pipe(Effect.mapError(fail("Failed to resume the group")));
      const id = newId();
      yield* dispatch(
        {
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(`group:${group.id}:continue:${id}`),
          threadId: group.threadId,
          message: {
            messageId: MessageId.makeUnsafe(`group-continue-${id}`),
            role: "user",
            text: input.continueText,
            attachments: [],
          },
          dispatchMode: "queue",
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: new Date().toISOString(),
        },
        "Failed to continue the group",
      );
    });

  const registerLive: GroupServiceShape["registerLive"] = (threadId, controls) => {
    live.set(threadId, controls);
    return () => {
      if (live.get(threadId) === controls) live.delete(threadId);
    };
  };

  // The group harness reaches the repository through this promise-based runtime.
  const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
  const groupIdOf = (value: string) => GroupId.makeUnsafe(value);
  const memberIdOf = (value: string) => GroupMemberId.makeUnsafe(value);
  const runtime: GroupRuntime = {
    loadGroup: (threadId) => run(repository.getByThreadId(ThreadId.makeUnsafe(threadId))),
    appendLog: (groupId, author, text) =>
      run(
        repository.appendLog(
          groupIdOf(groupId),
          author === "user" ? "user" : memberIdOf(author),
          text,
        ),
      ),
    logAfter: (groupId, seq) =>
      run(repository.logAfter(groupIdOf(groupId), seq)).then((rows) => [...rows]),
    memberRuntime: (memberId) => run(repository.getMemberRuntime(memberIdOf(memberId))),
    saveMemberRuntime: (memberId, patch) =>
      run(repository.saveMemberRuntime(memberIdOf(memberId), patch)),
    roundState: (groupId) =>
      run(repository.getRoundState(groupIdOf(groupId))).then((state) => ({
        lastSpeakers: [...state.lastSpeakers],
        lastRoundAll: state.lastRoundAll,
      })),
    saveRoundState: (groupId, state) =>
      run(
        repository.setRoundState(groupIdOf(groupId), {
          lastSpeakers: state.lastSpeakers.map(memberIdOf),
          lastRoundAll: state.lastRoundAll,
        }),
      ),
    takeResume: (groupId) => run(takeResume(groupIdOf(groupId))).then((handoffs) => [...handoffs]),
    savePause: (groupId, handoffs) => run(savePause(groupIdOf(groupId), handoffs)),
    recordReply: (reply) =>
      run(
        repository
          .recordReply(reply)
          .pipe(Effect.andThen(publish({ type: "reply.recorded", reply }))),
      ),
    setMemberState: (groupId, memberId, state) => {
      const id = memberIdOf(memberId);
      if (state === "idle") liveStates.delete(id);
      else liveStates.set(id, state);
      if (state === "idle" || state === "failed") liveDrafts.delete(id);
      Effect.runFork(
        publish({ type: "member.state", groupId: groupIdOf(groupId), memberId: id, state }),
      );
    },
    publishDraft: (groupId, memberId, delta, restart) => {
      const id = memberIdOf(memberId);
      const draft = restart ? delta : (liveDrafts.get(id) ?? "") + delta;
      liveDrafts.set(id, draft.slice(-LIVE_DRAFT_LIMIT));
      Effect.runFork(
        publish({ type: "reply.draft", groupId: groupIdOf(groupId), memberId: id, delta, restart }),
      );
    },
    skills: async () => {
      const settings = await run(settingsService.getSettings);
      const skills = await discoverSkillsCatalog({
        homeDir: config.homeDir,
        synaraBaseDir: config.baseDir,
      });
      return filterDisabledSkills(skills, settings.skills.disabled)
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          name: skill.name,
          description: skill.description ?? "",
          path: skill.path,
        }));
    },
  };
  bridge.attach({
    runtime,
    registerLive,
    // Skills folders only: a turn's attachments are added per message, never the whole
    // attachments folder, which holds every chat's files.
    readRoots: skillsCatalogRoots({ homeDir: config.homeDir, synaraBaseDir: config.baseDir }).map(
      (root) => root.path,
    ),
  });

  return {
    list,
    listReplies,
    live: liveNow,
    create,
    update,
    delete: remove,
    addMember,
    updateMember,
    removeMember,
    stopMember,
    resolvePause,
    savePause,
    takeResume,
    publish,
    registerLive,
    streamEvents: Stream.fromPubSub(events),
  } satisfies GroupServiceShape;
});

export const GroupServiceLive = Layer.effect(GroupService, makeGroupService);

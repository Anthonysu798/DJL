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
  GroupMissionId,
  MessageId,
  PROVIDER_DISPLAY_NAMES,
  ProjectId,
  ThreadId,
  type Group,
  type GroupEvent,
  type GroupLive,
  type GroupMember,
  type GroupMemberActivity,
  type GroupMemberState,
  type GroupMission,
  type GroupReaction,
  type GroupRoundProgress,
  type OrchestrationCommand,
  GROUP_GUEST_LIMIT,
  GroupGuestId,
  parseGroupGuestMessageId,
  type GroupGuest,
} from "@djl/contracts";
import { nextGroupHandle } from "@djl/shared/groupChat";
import { Effect, Layer, Option, PubSub, Queue, Stream } from "effect";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { ServerConfig } from "../../config";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { GroupRepository } from "../../persistence/Services/GroupRepository.ts";
import type { GroupCue, GroupRuntime } from "../../harnesses/native/group/groupRound";
import type { LentAgents } from "../../harnesses/native/group/lentAgent";
import { EMPTY_MISSION_STATS, pickPlanner } from "../../harnesses/native/group/groupMission";
import {
  discoverSkillsCatalog,
  filterDisabledSkills,
  skillsCatalogRoots,
} from "../../provider/skillsCatalog";
import { ServerSettingsService } from "../../serverSettings";
import { makeGuestAgentHub } from "../guestAgentHub";
import { GroupDriverBridge } from "../Services/GroupDriverBridge";
import {
  GroupService,
  GroupServiceError,
  type GroupLiveControls,
  type GroupServiceShape,
} from "../Services/GroupService";

// A runaway reply must not grow memory without bound; late joiners see its tail.
const LIVE_DRAFT_LIMIT = 24_000;
// Messages DJL posts for the user (reactions, missions) carry this id prefix; the chat hides them.
const CUE_MESSAGE_PREFIX = "group-cue-";
const CUE_LIMIT = 200;
// How long Undo waits for the checkpoint reactor to report back before giving up.
const UNDO_TIMEOUT_MS = 30_000;
// Logged as the user's message so every member learns it on its next wake.
const UNDO_NOTE =
  "[DJL] I undid the file changes from the latest round that changed files. Those changes are" +
  " no longer in the folder; check the files before building on them.";

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
  const liveRounds = new Map<GroupId, GroupRoundProgress>();
  const liveActivities = new Map<GroupMemberId, GroupMemberActivity>();
  // Why DJL posted each pending message, until the round picks it up.
  const cues = new Map<string, GroupCue>();
  const settingsService = yield* ServerSettingsService;
  const bridge = yield* GroupDriverBridge;
  // Which group each visiting agent belongs to, for telling clients when it comes and goes.
  const guestAgentGroups = new Map<string, GroupId>();
  const guestAgents = makeGuestAgentHub({
    onPresence: (guestId, online) => {
      const groupId = guestAgentGroups.get(guestId);
      if (!groupId) return;
      Effect.runFork(
        PubSub.publish(events, {
          type: "guestAgent.presence",
          groupId,
          guestId: GroupGuestId.makeUnsafe(guestId),
          online,
        }),
      );
    },
  });

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

  // Members briefed on an older setup (members, roles, mutes, lead, reviewer, brief) are
  // briefed again on their next wake.
  const bumpSetup = (groupId: GroupId) =>
    load(groupId).pipe(
      Effect.flatMap((group) =>
        repository.upsertGroup({
          ...rowOf(group),
          setupRev: group.setupRev + 1,
          updatedAt: Date.now(),
        }),
      ),
      Effect.mapError(fail("Failed to save the group")),
    );

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

  const liveNow = (): GroupLive => {
    const online = guestAgents.online().map((guestId) => GroupGuestId.makeUnsafe(guestId));
    return {
      memberStates: Object.fromEntries(liveStates),
      drafts: Object.fromEntries(liveDrafts),
      rounds: Object.fromEntries(liveRounds),
      activities: Object.fromEntries(liveActivities),
      ...(online.length > 0 ? { guestAgents: online } : {}),
    };
  };
  const forgetLive = (memberId: GroupMemberId) => {
    liveStates.delete(memberId);
    liveDrafts.delete(memberId);
    liveActivities.delete(memberId);
  };

  const saveMission = (mission: GroupMission) =>
    repository
      .upsertMission(mission)
      .pipe(
        Effect.mapError(fail("Failed to save the mission")),
        Effect.andThen(publish({ type: "mission.upserted", mission })),
      );

  const loadMission = (groupId: GroupId, missionId: GroupMissionId) =>
    repository.getMission(missionId).pipe(
      Effect.mapError(fail("Failed to read the mission")),
      Effect.flatMap((mission) =>
        mission && mission.groupId === groupId
          ? Effect.succeed(mission)
          : Effect.fail(new GroupServiceError({ message: "Mission not found" })),
      ),
    );

  // Posts a message for the user: into the running round when there is one, otherwise as a new
  // turn whose message the chat hides. The cue tells the round what the message is for.
  const postToGroup = (group: Group, text: string, cue: GroupCue) =>
    Effect.gen(function* () {
      const messageId = `${CUE_MESSAGE_PREFIX}${newId()}`;
      cues.set(messageId, cue);
      while (cues.size > CUE_LIMIT) cues.delete(cues.keys().next().value!);
      const posted = yield* Effect.tryPromise({
        try: async () => (await live.get(group.threadId)?.post(text, messageId)) ?? false,
        catch: fail("The running group did not respond"),
      });
      if (posted) return;
      yield* dispatch(
        {
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe(`group:${group.id}:cue:${newId()}`),
          threadId: group.threadId,
          message: {
            messageId: MessageId.makeUnsafe(messageId),
            role: "user",
            text,
            attachments: [],
          },
          dispatchMode: "queue",
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: new Date().toISOString(),
        },
        "Failed to send to the group",
      );
    });

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
          brief: input.brief ?? "",
          setupRev: 0,
          defaultRecipient: input.defaultRecipient ?? "last",
          reviewerMemberId: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(Effect.mapError(fail("Failed to save the group")));
      const handles: string[] = [];
      let lead: GroupMemberId | null = null;
      let reviewer: GroupMemberId | null = null;
      for (const [position, member] of input.members.entries()) {
        const handle = nextGroupHandle(PROVIDER_DISPLAY_NAMES[member.provider], handles);
        handles.push(handle);
        const id = GroupMemberId.makeUnsafe(newId());
        if (member.lead && !lead) lead = id;
        if (member.reviewer && !reviewer) reviewer = id;
        yield* saveMember({
          id,
          groupId,
          provider: member.provider,
          handle,
          role: member.role ?? null,
          model: null,
          position,
          muted: false,
          contextUsage: null,
        });
      }
      if (lead || reviewer) {
        const group = yield* load(groupId);
        yield* repository
          .upsertGroup({
            ...rowOf(group),
            ...(lead ? { defaultRecipient: lead } : {}),
            reviewerMemberId: reviewer,
          })
          .pipe(Effect.mapError(fail("Failed to save the group")));
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
      let setupChanged = false;
      if (input.brief !== undefined && input.brief.trim() !== group.brief.trim()) {
        next = { ...next, brief: input.brief.trim() };
        setupChanged = true;
      }
      const isMember = (memberId: string) => group.members.some((member) => member.id === memberId);
      const recipient = input.defaultRecipient;
      if (recipient !== undefined) {
        if (recipient !== "last" && recipient !== "all" && !isMember(recipient))
          return yield* new GroupServiceError({ message: "Member not found" });
        if (recipient !== group.defaultRecipient) setupChanged = true;
        next = { ...next, defaultRecipient: recipient };
      }
      const reviewer = input.reviewerMemberId;
      if (reviewer !== undefined) {
        if (reviewer !== null && !isMember(reviewer))
          return yield* new GroupServiceError({ message: "Member not found" });
        if (reviewer !== group.reviewerMemberId) setupChanged = true;
        next = { ...next, reviewerMemberId: reviewer };
      }
      if (setupChanged) next = { ...next, setupRev: group.setupRev + 1 };
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
      liveRounds.delete(groupId);
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
        muted: false,
        contextUsage: null,
      });
      yield* bumpSetup(group.id);
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
        ...(input.muted !== undefined ? { muted: input.muted } : {}),
      });
      const roleChanged = input.role !== undefined && input.role !== member.role;
      const muteChanged = input.muted !== undefined && input.muted !== member.muted;
      if (roleChanged || muteChanged) yield* bumpSetup(group.id);
      if (input.model !== undefined && input.model !== member.model) {
        // A new model needs a new CLI session; the member is re-briefed on its next wake. The
        // running round drops the CLI and ignores the saved session before storage forgets it.
        yield* callLive(group.threadId, (controls) => controls.resetMember(member.id));
        yield* repository
          .resetMemberSession(member.id)
          .pipe(Effect.mapError(fail("Failed to reset the member")));
      }
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
      // A removed lead or reviewer must not keep routing messages to nobody.
      const wasLead = group.defaultRecipient === memberId;
      const wasReviewer = group.reviewerMemberId === memberId;
      const current = yield* load(groupId);
      yield* repository
        .upsertGroup({
          ...rowOf(current),
          ...(wasLead ? { defaultRecipient: "last" as const } : {}),
          ...(wasReviewer ? { reviewerMemberId: null } : {}),
          setupRev: current.setupRev + 1,
          updatedAt: Date.now(),
        })
        .pipe(Effect.mapError(fail("Failed to save the group")));
      return yield* changed(groupId);
    });

  const resetMember: GroupServiceShape["resetMember"] = ({ groupId, memberId }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      if (!group.members.some((member) => member.id === memberId))
        return yield* new GroupServiceError({ message: "Member not found" });
      // The running round drops the CLI and ignores the saved session before storage forgets it.
      yield* callLive(group.threadId, (controls) => controls.resetMember(memberId));
      yield* repository
        .resetMemberSession(memberId)
        .pipe(Effect.mapError(fail("Failed to reset the member")));
      return yield* changed(groupId);
    });

  const undoRound: GroupServiceShape["undoRound"] = ({ groupId, turnCount }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      const { sequence } = yield* engine
        .dispatch({
          type: "thread.checkpoint.revert",
          commandId: CommandId.makeUnsafe(`group:${group.id}:undo:${newId()}`),
          threadId: group.threadId,
          turnCount,
          scope: "files",
          createdAt: new Date().toISOString(),
        })
        .pipe(Effect.mapError(fail("Failed to undo the changes")));
      // The checkpoint reactor undoes the files after the command is stored. It reports success
      // as that turn's diff with no files, and failure as a thread activity; members are told
      // only once the files really changed back.
      type UndoOutcome = { ok: true } | { ok: false; detail: string };
      const outcome = yield* engine.streamDomainEventsFrom(sequence).pipe(
        Stream.map((event): UndoOutcome | null => {
          if (
            event.type === "thread.turn-diff-completed" &&
            event.payload.threadId === group.threadId &&
            event.payload.checkpointTurnCount === turnCount &&
            event.payload.files.length === 0
          )
            return { ok: true };
          if (
            event.type === "thread.activity-appended" &&
            event.payload.threadId === group.threadId &&
            event.payload.activity.kind === "checkpoint.revert.failed"
          ) {
            const detail = (event.payload.activity.payload as { detail?: unknown }).detail;
            return { ok: false, detail: typeof detail === "string" ? detail : "" };
          }
          return null;
        }),
        Stream.filter((value): value is UndoOutcome => value !== null),
        Stream.runHead,
        Effect.timeoutOption(UNDO_TIMEOUT_MS),
        Effect.map(Option.flatten),
        Effect.mapError(fail("Failed to undo the changes")),
      );
      if (Option.isNone(outcome))
        return yield* new GroupServiceError({ message: "The undo did not finish in time." });
      if (!outcome.value.ok)
        return yield* new GroupServiceError({
          message: outcome.value.detail || "The changes could not be undone.",
        });
      yield* repository
        .appendLog(group.id, "user", UNDO_NOTE)
        .pipe(Effect.mapError(fail("Failed to note the undo")));
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

  const listReactions: GroupServiceShape["listReactions"] = () =>
    repository.listReactions().pipe(Effect.mapError(fail("Failed to list reactions")));
  const listMissions: GroupServiceShape["listMissions"] = () =>
    repository.listMissions().pipe(Effect.mapError(fail("Failed to list missions")));

  const putReaction = (reaction: GroupReaction, slot: string) =>
    repository
      .setReaction(reaction, slot)
      .pipe(
        Effect.mapError(fail("Failed to save the reaction")),
        Effect.andThen(publish({ type: "reaction.set", reaction })),
      );
  const dropReaction = (reaction: Omit<GroupReaction, "createdAt">, slot: string) =>
    repository
      .removeReaction(reaction.groupId, reaction.targetId, reaction.actor, slot)
      .pipe(
        Effect.mapError(fail("Failed to remove the reaction")),
        Effect.andThen(publish({ type: "reaction.removed", ...reaction })),
      );

  const react: GroupServiceShape["react"] = ({ groupId, replyId, kind, message }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      const reply = (yield* repository
        .listReplies(groupId)
        .pipe(Effect.mapError(fail("Failed to read the answer")))).find(
        (entry) => entry.replyId === replyId,
      );
      const member = reply ? group.members.find((entry) => entry.id === reply.memberId) : undefined;
      if (!reply || !member)
        return yield* new GroupServiceError({ message: "That answer's agent left the group" });
      const reaction: GroupReaction = {
        groupId,
        targetId: replyId,
        actor: "user",
        kind,
        createdAt: Date.now(),
      };
      if (kind === "like") {
        // A like is feedback, not a request: it toggles and the agent reads it on its next wake.
        const existing = yield* repository
          .getReaction(groupId, replyId, "user", "like")
          .pipe(Effect.mapError(fail("Failed to read the reaction")));
        if (existing) return yield* dropReaction(reaction, "like");
        yield* putReaction(reaction, "like");
        yield* repository
          .appendLog(group.id, "user", `👍 (the user liked @${member.handle}'s answer)`)
          .pipe(Effect.mapError(fail("Failed to note the reaction")));
        return;
      }
      if (!message) return yield* new GroupServiceError({ message: "Nothing to send" });
      yield* putReaction(reaction, kind);
      yield* postToGroup(group, message, { kind: "reaction", targetId: replyId });
    });

  const missionPlan: GroupServiceShape["missionPlan"] = ({ groupId, goal, message }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      const planner = pickPlanner(group);
      if (!planner) return yield* new GroupServiceError({ message: "The group has no members" });
      const mission: GroupMission = {
        id: GroupMissionId.makeUnsafe(newId()),
        groupId,
        goal,
        status: "planning",
        plannerMemberId: planner.id,
        planReplyId: null,
        steps: [],
        currentStep: 0,
        stats: EMPTY_MISSION_STATS,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
      };
      yield* saveMission(mission);
      yield* postToGroup(group, `@${planner.handle} ${message}`, {
        kind: "missionPlan",
        missionId: mission.id,
      });
      return mission;
    });

  const missionStart: GroupServiceShape["missionStart"] = (input) =>
    Effect.gen(function* () {
      const group = yield* load(input.groupId);
      const mission = yield* loadMission(input.groupId, input.missionId);
      if (mission.status !== "ready" && mission.status !== "paused")
        return yield* new GroupServiceError({ message: "This mission cannot start now" });
      let steps = [...mission.steps];
      let current = Math.min(mission.currentStep, Math.max(0, steps.length - 1));
      const skipped = steps[current];
      if (input.skipCurrent && skipped) {
        steps[current] = { ...skipped, status: "skipped" };
        const next = steps.findIndex(
          (step, index) =>
            index > current && (step.status === "pending" || step.status === "failed"),
        );
        if (next === -1) {
          const finished: GroupMission = {
            ...mission,
            steps,
            status: "done",
            finishedAt: Date.now(),
          };
          yield* saveMission(finished);
          return finished;
        }
        current = next;
      }
      if (!steps[current])
        return yield* new GroupServiceError({ message: "This mission has no steps" });
      // A retried step starts over.
      steps = steps.map((step, index) =>
        index === current ? { ...step, status: "pending" as const } : step,
      );
      const running: GroupMission = {
        ...mission,
        steps,
        status: "running",
        currentStep: current,
        startedAt: mission.startedAt ?? Date.now(),
      };
      yield* saveMission(running);
      yield* postToGroup(group, input.message, { kind: "missionStart", missionId: mission.id });
      return running;
    });

  const missionStop: GroupServiceShape["missionStop"] = ({ groupId, missionId }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      const mission = yield* loadMission(groupId, missionId);
      if (mission.status === "done" || mission.status === "stopped") return mission;
      const wasRunning = mission.status === "running";
      const stopped: GroupMission = {
        ...mission,
        status: "stopped",
        steps: mission.steps.map((step) =>
          step.status === "running" ? { ...step, status: "pending" as const } : step,
        ),
        finishedAt: Date.now(),
      };
      yield* saveMission(stopped);
      // The member on the current step stops too; others keep whatever else they were doing.
      const current = mission.steps[mission.currentStep];
      if (wasRunning && current)
        yield* callLive(group.threadId, (controls) => controls.stopMember(current.memberId));
      return stopped;
    });

  const missionRemoveStep: GroupServiceShape["missionRemoveStep"] = ({
    groupId,
    missionId,
    index,
  }) =>
    Effect.gen(function* () {
      const mission = yield* loadMission(groupId, missionId);
      if (mission.status !== "ready")
        return yield* new GroupServiceError({ message: "Steps can change only before it starts" });
      const next: GroupMission = {
        ...mission,
        steps: mission.steps.filter((_step, position) => position !== index),
      };
      yield* saveMission(next);
      return next;
    });

  const registerLive: GroupServiceShape["registerLive"] = (threadId, controls) => {
    live.set(threadId, controls);
    return () => {
      if (live.get(threadId) === controls) live.delete(threadId);
    };
  };

  // The group harness reaches the repository through this promise-based runtime.
  const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
  const saveGuests = (group: Group, guests: ReadonlyArray<GroupGuest>) =>
    repository.setGuests(group.id, guests).pipe(
      Effect.mapError(fail("Failed to save the guest list")),
      Effect.flatMap(() => changed(group.id)),
    );

  const inviteGuest: GroupServiceShape["inviteGuest"] = ({ groupId, name, role }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      const guests = group.guests ?? [];
      if (guests.length >= GROUP_GUEST_LIMIT)
        return yield* new GroupServiceError({
          message: `A group can have at most ${GROUP_GUEST_LIMIT} guests`,
        });
      if (guests.some((guest) => guest.name.toLowerCase() === name.toLowerCase()))
        return yield* new GroupServiceError({ message: "A guest with this name already exists" });
      const guest: GroupGuest = {
        id: GroupGuestId.makeUnsafe(newId().slice(0, 16)),
        name,
        role,
        createdAt: Date.now(),
      };
      return yield* saveGuests(group, [...guests, guest]);
    });

  const updateGuest: GroupServiceShape["updateGuest"] = ({ groupId, guestId, role }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      const guests = group.guests ?? [];
      const current = guests.find((guest) => guest.id === guestId);
      if (!current) return yield* new GroupServiceError({ message: "Guest not found" });
      // A person and a lent agent connect in different ways, so one cannot become the other.
      if ((current.role === "agent") !== (role === "agent"))
        return yield* new GroupServiceError({
          message: "Invite them again to change between a person and an agent",
        });
      return yield* saveGuests(
        group,
        guests.map((guest) => (guest.id === guestId ? { ...guest, role } : guest)),
      );
    });

  const removeGuest: GroupServiceShape["removeGuest"] = ({ groupId, guestId }) =>
    Effect.gen(function* () {
      const group = yield* load(groupId);
      // A guest's visiting agent leaves with the guest.
      guestAgents.forget(guestId);
      const visiting = group.members.find((member) => member.guestId === guestId);
      if (visiting) yield* removeMember({ groupId, memberId: visiting.id });
      return yield* saveGuests(
        group,
        (group.guests ?? []).filter((guest) => guest.id !== guestId),
      );
    });

  const guestAgentJoin: GroupServiceShape["guestAgentJoin"] = (input) =>
    Effect.gen(function* () {
      const group = yield* load(input.groupId);
      const guest = group.guests?.find((entry) => entry.id === input.guestId);
      if (!guest || guest.role !== "agent")
        return yield* new GroupServiceError({ message: "This guest cannot bring an agent" });
      guestAgentGroups.set(guest.id, group.id);
      guestAgents.seen(guest.id, input.sessionId);
      const existing = group.members.find((member) => member.guestId === guest.id);
      // Most calls only say "still here": nothing to save.
      if (existing && existing.provider === input.provider && existing.model === input.model)
        return group;
      yield* saveMember(
        existing
          ? { ...existing, provider: input.provider, model: input.model }
          : {
              id: GroupMemberId.makeUnsafe(newId()),
              groupId: group.id,
              provider: input.provider,
              handle: nextGroupHandle(
                guest.name,
                group.members.map((member) => member.handle),
              ),
              role: null,
              model: input.model,
              position: Math.max(-1, ...group.members.map((member) => member.position)) + 1,
              muted: false,
              contextUsage: null,
              guestId: guest.id,
            },
      );
      yield* bumpSetup(group.id);
      return yield* changed(group.id);
    });

  // Only a guest that still holds the agent role may answer; a removed one is ignored.
  const agentGuest = (groupId: GroupId, guestId: string) =>
    load(groupId).pipe(
      Effect.map((group) =>
        group.guests?.some((guest) => guest.id === guestId && guest.role === "agent"),
      ),
    );

  const guestAgentReply: GroupServiceShape["guestAgentReply"] = (input) =>
    agentGuest(input.groupId, input.guestId).pipe(
      Effect.map((allowed) => {
        if (allowed) guestAgents.reply(input.guestId, input.turnId, input.status, input.text);
      }),
    );

  const guestAgentDraft: GroupServiceShape["guestAgentDraft"] = (input) =>
    Effect.sync(() => guestAgents.draft(input.guestId, input.turnId, input.delta, input.restart));

  const guestAgentTurns: GroupServiceShape["guestAgentTurns"] = ({ groupId, guestId }) =>
    Stream.callback((queue) =>
      Effect.gen(function* () {
        guestAgentGroups.set(guestId, groupId);
        const stop = guestAgents.listen(guestId, (event) => {
          Queue.offerUnsafe(queue, event);
        });
        yield* Effect.addFinalizer(() => Effect.sync(stop));
      }),
    );

  const lentAgents = Effect.suspend(() => {
    const agents = bridge.lentAgents();
    if (agents) return Effect.succeed(agents);
    return Effect.fail(new GroupServiceError({ message: "DJL is still starting. Try again." }));
  }) as Effect.Effect<LentAgents, GroupServiceError>;

  const lentAgentOpen: GroupServiceShape["lentAgentOpen"] = ({ linkId }) =>
    lentAgents.pipe(Effect.map((agents) => ({ sessionId: agents.open(linkId) })));

  const lentAgentClose: GroupServiceShape["lentAgentClose"] = ({ linkId }) =>
    lentAgents.pipe(Effect.map((agents) => agents.close(linkId)));

  const lentAgentAsk: GroupServiceShape["lentAgentAsk"] = (input) =>
    Stream.callback((queue) =>
      Effect.gen(function* () {
        const agents = bridge.lentAgents();
        if (!agents) {
          Queue.offerUnsafe(queue, {
            type: "done",
            status: "failed",
            text: "DJL is still starting. Try again.",
          });
          return yield* Queue.end(queue);
        }
        yield* Effect.promise(() =>
          agents.ask(input, (delta, restart) => {
            Queue.offerUnsafe(queue, { type: "draft", delta, restart });
          }),
        ).pipe(
          Effect.map((answer) => {
            Queue.offerUnsafe(queue, { type: "done", ...answer });
          }),
          // The other computer gave up on this turn (stop, or its connection dropped).
          Effect.onInterrupt(() => Effect.promise(() => agents.stop(input.linkId))),
          Effect.ensuring(Queue.end(queue)),
        );
      }),
    );

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
    saveMemberRuntime: async (memberId, patch) => {
      await run(repository.saveMemberRuntime(memberIdOf(memberId), patch));
      if (patch.contextUsage === undefined) return;
      // The members panel shows each member's context meter from the group record.
      const owner = await run(repository.listGroups()).then((groups) =>
        groups.find((group) => group.members.some((entry) => entry.id === memberId)),
      );
      if (owner) await run(changed(owner.id).pipe(Effect.ignore));
    },
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
    publishProgress: (groupId, progress) => {
      const id = groupIdOf(groupId);
      if (progress) liveRounds.set(id, progress);
      else liveRounds.delete(id);
      Effect.runFork(publish({ type: "round.progress", groupId: id, progress }));
    },
    publishDraft: (groupId, memberId, delta, restart) => {
      const id = memberIdOf(memberId);
      const draft = restart ? delta : (liveDrafts.get(id) ?? "") + delta;
      liveDrafts.set(id, draft.slice(-LIVE_DRAFT_LIMIT));
      Effect.runFork(
        publish({ type: "reply.draft", groupId: groupIdOf(groupId), memberId: id, delta, restart }),
      );
    },
    guestOf: async (groupId, messageId) => {
      const guestId = parseGroupGuestMessageId(messageId);
      if (guestId === null) return undefined;
      const group = await Effect.runPromise(
        repository.getById(groupIdOf(groupId)).pipe(Effect.orElseSucceed(() => null)),
      );
      // A removed guest, or one who may only watch, gets nobody's attention.
      const guest = group?.guests?.find((entry) => entry.id === guestId);
      return guest && guest.role === "chat" ? { name: guest.name } : null;
    },
    takeCue: async (messageId) => {
      const cue = cues.get(messageId) ?? null;
      cues.delete(messageId);
      return cue;
    },
    setReaction: (groupId, targetId, memberId, kind) => {
      const base = { groupId: groupIdOf(groupId), targetId, actor: memberId };
      Effect.runFork(
        (kind
          ? putReaction({ ...base, kind, createdAt: Date.now() }, "status")
          : dropReaction({ ...base, kind: "seen" }, "status")
        ).pipe(Effect.ignore),
      );
    },
    publishActivity: (groupId, memberId, activity) => {
      const id = memberIdOf(memberId);
      if (activity) liveActivities.set(id, activity);
      else liveActivities.delete(id);
      Effect.runFork(
        publish({ type: "member.activity", groupId: groupIdOf(groupId), memberId: id, activity }),
      );
    },
    loadMission: (missionId) => run(repository.getMission(GroupMissionId.makeUnsafe(missionId))),
    saveMission: (mission) => run(saveMission(mission)),
    skills: async () => {
      const settings = await run(settingsService.getSettings);
      const skills = await discoverSkillsCatalog({
        homeDir: config.homeDir,
        djlBaseDir: config.baseDir,
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
    guestAgents,
    // Skills folders only: a turn's attachments are added per message, never the whole
    // attachments folder, which holds every chat's files.
    readRoots: skillsCatalogRoots({ homeDir: config.homeDir, djlBaseDir: config.baseDir }).map(
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
    resetMember,
    undoRound,
    listReactions,
    listMissions,
    react,
    missionPlan,
    missionStart,
    missionStop,
    missionRemoveStep,
    inviteGuest,
    updateGuest,
    removeGuest,
    guestAgentJoin,
    guestAgentReply,
    guestAgentDraft,
    guestAgentTurns,
    lentAgentOpen,
    lentAgentClose,
    lentAgentAsk,
    savePause,
    takeResume,
    publish,
    registerLive,
    streamEvents: Stream.fromPubSub(events),
  } satisfies GroupServiceShape;
});

export const GroupServiceLive = Layer.effect(GroupService, makeGroupService);

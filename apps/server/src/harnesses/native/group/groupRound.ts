// FILE: groupRound.ts
// Purpose: Routes one group "round": decides which members a message wakes, runs each member
//          in its own queue, follows agent-to-agent hand-offs and automatic reviews up to the hop
//          limit, hands a failed sole task to the next member, reports members that go quiet,
//          and records what was said.
// Layer: Native harness (group)

import {
  GROUP_CATCH_UP_LIMIT,
  GROUP_QUIET_AFTER_MS,
  PROVIDER_DISPLAY_NAMES,
  type Group,
  type GroupContextUsage,
  type GroupHandoff,
  type GroupMember,
  type GroupMemberId,
  type GroupMemberActivity,
  type GroupMemberReaction,
  type GroupMemberState,
  type GroupMission,
  type GroupReply,
  type GroupRoundProgress,
} from "@djl/contracts";
import { parseGroupMentions } from "@djl/shared/groupChat";

import type { ChildReply, ChildSession } from "./childSession";
import { createWriteLock, decideRequest } from "./groupPolicy";
import { addMissionStats, parseMissionPlan, withStepStatus } from "./groupMission";
import { buildMemberPrompt, isPassReply, selectMissed, type PromptMember } from "./groupPrompt";

// Localized spellings of @all that users type in Chinese group chats.
const ALL_ALIASES = ["所有人", "全体成员", "全体"];
const USER_LABEL = "User";
const GUEST_SUFFIX = " (guest)";
const EMPTY_REPLY_TEXT = "…";
const QUIET_CHECK_MS = 15_000;

/** Why DJL posted a message to the group on the user's behalf. */
export type GroupCue =
  | { kind: "reaction"; targetId: string }
  | { kind: "missionPlan"; missionId: string }
  | { kind: "missionStart"; missionId: string };

export interface GroupRuntime {
  loadGroup(threadId: string): Promise<Group | null>;
  appendLog(groupId: string, author: "user" | string, text: string): Promise<number>;
  logAfter(groupId: string, seq: number): Promise<{ seq: number; author: string; text: string }[]>;
  memberRuntime(memberId: string): Promise<{
    nativeSessionId: string | null;
    readSeq: number;
    /** The brief revision the member last received; 0 when it never did. */
    setupRevSeen?: number;
  }>;
  saveMemberRuntime(
    memberId: string,
    patch: {
      nativeSessionId?: string | null;
      readSeq?: number;
      setupRevSeen?: number;
      contextUsage?: GroupContextUsage | null;
    },
  ): Promise<void>;
  roundState(groupId: string): Promise<{ lastSpeakers: string[]; lastRoundAll: boolean }>;
  saveRoundState(
    groupId: string,
    state: { lastSpeakers: string[]; lastRoundAll: boolean },
  ): Promise<void>;
  /** Pending hand-offs if the user chose Continue; always clears the pause. */
  takeResume(groupId: string): Promise<GroupHandoff[]>;
  savePause(groupId: string, handoffs: GroupHandoff[]): Promise<void>;
  recordReply(reply: GroupReply): Promise<void>;
  setMemberState(groupId: string, memberId: string, state: GroupMemberState): void;
  /** Sends the text a member is writing right now to clients; it is never stored. */
  publishDraft(groupId: string, memberId: string, delta: string, restart: boolean): void;
  /** Hand-offs used and quiet members while a round runs; null when it ends. */
  publishProgress(groupId: string, progress: GroupRoundProgress | null): void;
  /** The cue DJL registered for a message it posted, taken once. */
  takeCue(messageId: string): Promise<GroupCue | null>;
  /**
   * Who wrote a message that came from an invited guest: undefined for the owner's own messages,
   * null for a guest who was removed or may only watch (their message wakes nobody).
   */
  guestOf(groupId: string, messageId: string): Promise<{ name: string } | null | undefined>;
  /** A member's status reaction on a message or reply; null removes it. */
  setReaction(
    groupId: string,
    targetId: string,
    memberId: string,
    kind: GroupMemberReaction | null,
  ): void;
  /** What a member is doing now, for the live stage; null when it stops working. */
  publishActivity(groupId: string, memberId: string, activity: GroupMemberActivity | null): void;
  loadMission(missionId: string): Promise<GroupMission | null>;
  saveMission(mission: GroupMission): Promise<void>;
  skills(): Promise<{ name: string; description: string; path: string }[]>;
}

export interface RoundHost {
  runtime: GroupRuntime;
  /** Returns the member's open child, opening it (resuming `resume` when given) if needed. */
  openChild(member: GroupMember, resume: string | null): Promise<ChildSession>;
  dropChild(memberId: string): void;
  /** Posts one member's reply into the group thread. */
  emitReply(memberId: string, replyId: string, text: string): void;
  newId(): string;
  /** Extra folders members may read without asking (skills, attachments). */
  readRoots?: readonly string[];
  /** Overrides for tests: how long without activity makes a member quiet, and how often to look. */
  quietAfterMs?: number;
  quietCheckMs?: number;
}

export type RoundExtras = {
  attachments?: string[];
  pastedSkills?: { name: string; markdown: string }[];
  /** The thread message that carried this text; members react to it. */
  messageId?: string;
};

export interface Round {
  /** Adds a message to the running round; false once the round has ended. */
  post(text: string, extras?: RoundExtras): boolean;
  stopMember(memberId: string): Promise<void>;
  /** Stops the member and drops its CLI first, so its next wake opens a fresh session. */
  resetMember(memberId: string): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  stopAll(): Promise<void>;
  done: Promise<void>;
}

interface Wake {
  memberId: string;
  messageSeq: number;
  fromLabel: string;
  text: string;
  proposeOnly: boolean;
  /** The name of the invited guest who wrote the message; such wakes only propose. */
  guest?: string;
  /** The member may answer with the pass token (rounds that went to everyone). */
  allowPass: boolean;
  /** This wake is an automatic review of another member's file changes. */
  review: { authorHandle: string; files: string[] } | null;
  extras: RoundExtras;
  /** The task was already handed over once after a failure. */
  handedOver: boolean;
  /** The message or reply the member reacts to while it works on this. */
  target: string | null;
  /** The member whose hand-off started this wake. */
  fromMemberId: string | null;
  /** The mission step this wake belongs to. */
  mission: { missionId: string; step: number } | null;
  /** This wake plans the mission with this id. */
  missionPlan: string | null;
}

type WakeOutcome = "ok" | "empty" | "passed" | "failed" | "stopped";
const OUTCOME_REACTION: Record<WakeOutcome, GroupMemberReaction | null> = {
  ok: "done",
  empty: "done",
  passed: "passed",
  failed: "failed",
  stopped: null,
};

type MissionRun = {
  open: number;
  ok: boolean;
  stopped: boolean;
  paused: boolean;
  files: Set<string>;
  commands: number;
  reviews: number;
  replies: number;
};

const unique = (values: readonly string[]) => [...new Set(values)];

export function startRound(
  host: RoundHost,
  group: Group,
  text: string,
  extras: RoundExtras = {},
): Round {
  const { runtime } = host;
  const members = new Map<string, GroupMember>(group.members.map((entry) => [entry.id, entry]));
  // Settings can change while a round runs (mute, model, lead, reviewer, brief); each step reads
  // the latest ones. Members removed from this round stay out even if a stale read still has them.
  let settings: Group = group;
  const removed = new Set<string>();
  const refresh = async () => {
    const latest = await runtime.loadGroup(group.threadId).catch(() => null);
    if (!latest || latest.id !== group.id) return;
    settings = latest;
    const current = new Set(latest.members.map((entry) => entry.id as string));
    // Deleting the entry being visited is safe while iterating a Map.
    for (const memberId of members.keys()) if (!current.has(memberId)) members.delete(memberId);
    for (const entry of latest.members) if (!removed.has(entry.id)) members.set(entry.id, entry);
  };
  // "Start fresh" bumps a member's reset count: a reply from before the reset is dropped, and the
  // next wake ignores the saved session even before storage has forgotten it.
  const resets = new Map<string, number>();
  const freshNext = new Set<string>();
  // What each member was last shown doing, so the stage gets only changes.
  const shownActivity = new Map<string, string>();
  const showActivity = (memberId: string, activity: GroupMemberActivity | null) => {
    const key = activity ? `${activity.kind}|${activity.detail ?? ""}|${activity.from ?? ""}` : "";
    if ((shownActivity.get(memberId) ?? "") === key) return;
    if (key) shownActivity.set(memberId, key);
    else shownActivity.delete(memberId);
    runtime.publishActivity(group.id, memberId, activity);
  };
  // Mission steps running in this round: how many of a step's wakes are still open, and what
  // they did. A step ends when its last wake (hand-offs and reviews included) settles.
  const missionRuns = new Map<string, MissionRun>();
  const queues = new Map<string, Wake[]>();
  const running = new Map<string, ChildSession | null>();
  // Aborting a member's controller cancels its lock wait; its late reply is then ignored.
  const aborts = new Map<string, AbortController>();
  const spoke: string[] = [];
  const pending: GroupHandoff[] = [];
  const lock = createWriteLock();
  const roots = [group.folder, ...(host.readRoots ?? [])];
  let hops = 0;
  let lastRoundAll = false;
  let replied = false;
  let chain: Promise<void> = Promise.resolve();
  let chainBusy = 0;
  let finished = false;
  const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>();
  // Members waiting for the write lock are not quiet; members with no recent activity are.
  const waitingLock = new Set<string>();
  const quiet = new Set<string>();
  let publishedProgress = "";
  const publishProgress = () => {
    const progress: GroupRoundProgress = {
      hops,
      hopLimit: settings.hopLimit,
      quiet: [...quiet] as GroupMemberId[],
    };
    const key = JSON.stringify(progress);
    if (key === publishedProgress) return;
    publishedProgress = key;
    runtime.publishProgress(group.id, progress);
  };
  const useHop = () => {
    hops += 1;
    publishProgress();
  };
  const quietAfter = host.quietAfterMs ?? GROUP_QUIET_AFTER_MS;
  const checkQuiet = () => {
    const now = Date.now();
    let changed = false;
    for (const [memberId, child] of running) {
      const isQuiet =
        child !== null && !waitingLock.has(memberId) && now - child.lastActivityAt() >= quietAfter;
      if (isQuiet === quiet.has(memberId)) continue;
      if (isQuiet) quiet.add(memberId);
      else quiet.delete(memberId);
      changed = true;
    }
    // Deleting the entry being visited is safe while iterating a Set.
    for (const memberId of quiet) {
      if (running.get(memberId)) continue;
      quiet.delete(memberId);
      changed = true;
    }
    if (changed) publishProgress();
  };
  const quietTimer = setInterval(checkQuiet, host.quietCheckMs ?? QUIET_CHECK_MS);
  quietTimer.unref?.();

  const label = (author: string) =>
    author === "user"
      ? USER_LABEL
      : (members.get(author)?.handle ??
        // A guest's messages are logged under "Name (guest)".
        (author.endsWith(GUEST_SUFFIX) ? author : "Removed agent"));
  const handles = () => [...members.values()].map((entry) => entry.handle);
  const byHandle = (handle: string) =>
    [...members.values()].find((entry) => entry.handle === handle);

  const finishIfIdle = async () => {
    if (finished || chainBusy > 0 || running.size > 0) return;
    if ([...queues.values()].some((queue) => queue.length > 0)) return;
    finished = true;
    clearInterval(quietTimer);
    if (publishedProgress) runtime.publishProgress(group.id, null);
    try {
      if (spoke.length > 0)
        await runtime.saveRoundState(group.id, { lastSpeakers: [...spoke], lastRoundAll });
      else
        await runtime.saveRoundState(group.id, {
          ...(await runtime.roundState(group.id)),
          lastRoundAll,
        });
      if (pending.length > 0) await runtime.savePause(group.id, [...pending]);
    } catch {
      // The group may have been deleted while the round finished; the round still ends.
    } finally {
      resolveDone();
    }
  };

  const enqueue = (wake: Wake) => {
    if (!members.has(wake.memberId)) return;
    if (wake.mission) {
      const run = missionRuns.get(wake.mission.missionId);
      if (run) run.open += 1;
    }
    const queue = queues.get(wake.memberId) ?? [];
    queue.push(wake);
    queues.set(wake.memberId, queue);
    if (!running.has(wake.memberId)) void drain(wake.memberId).catch(() => undefined);
  };

  const promptMembers = (): PromptMember[] =>
    [...members.values()].map((entry) => ({
      id: entry.id,
      handle: entry.handle,
      providerName: PROVIDER_DISPLAY_NAMES[entry.provider],
      role: entry.role,
      muted: entry.muted,
      lead: settings.defaultRecipient === entry.id,
      visiting: entry.guestId !== undefined,
    }));

  const openFor = async (member: GroupMember) => {
    const saved = await runtime.memberRuntime(member.id);
    if (saved.nativeSessionId && !freshNext.has(member.id)) {
      try {
        return { child: await host.openChild(member, saved.nativeSessionId), fresh: false, saved };
      } catch {
        // The saved session cannot be resumed (expired, or the CLI cannot load sessions).
        host.dropChild(member.id);
      }
    }
    const child = await host.openChild(member, null);
    freshNext.delete(member.id);
    return { child, fresh: true, saved };
  };

  const stoppedReply: ChildReply = { status: "stopped", work: { files: [], commands: [] } };
  // Stop or removal can land while the member's CLI is still starting.
  const isStopped = (memberId: string) =>
    !members.has(memberId) || aborts.get(memberId)?.signal.aborted === true;

  const ask = async (
    member: GroupMember,
    wake: Wake,
  ): Promise<{ reply: ChildReply; child: ChildSession | null }> => {
    try {
      const { child, fresh, saved } = await openFor(member);
      if (isStopped(member.id)) return { reply: stoppedReply, child: null };
      running.set(member.id, child);
      const after = fresh ? 0 : saved.readSeq;
      const entries = (await runtime.logAfter(group.id, after)).filter(
        (entry) => entry.seq < wake.messageSeq && entry.author !== member.id,
      );
      const { missed, skipped } = selectMissed(
        entries.map((entry) => ({
          seq: entry.seq,
          authorLabel: label(entry.author),
          text: entry.text,
        })),
        GROUP_CATCH_UP_LIMIT,
      );
      const prompt = buildMemberPrompt({
        groupName: settings.name,
        self: promptMembers().find((entry) => entry.id === member.id)!,
        members: promptMembers(),
        // A visiting agent runs on another computer: this one's skill files and attachments
        // are paths it cannot open.
        skills: fresh && !member.guestId ? await runtime.skills() : [],
        briefing: fresh,
        missed,
        skipped,
        message: { fromLabel: wake.fromLabel, text: wake.text },
        readOnly: wake.review ? "review" : wake.guest ? "guest" : wake.proposeOnly ? "all" : null,
        guestName: wake.guest ?? null,
        attachments: member.guestId ? [] : (wake.extras.attachments ?? []),
        pastedSkills: wake.extras.pastedSkills ?? [],
        brief: settings.brief,
        setupChanged: !fresh && (saved.setupRevSeen ?? 0) < settings.setupRev,
        allowPass: wake.allowPass,
        review: wake.review,
        planRequest: wake.missionPlan
          ? { handles: [...members.values()].map((entry) => entry.handle) }
          : null,
        mission: wake.mission ? await missionPrompt(wake.mission) : null,
      });
      const abort = aborts.get(member.id);
      if (isStopped(member.id)) return { reply: stoppedReply, child: null };
      const from = wake.fromMemberId as GroupMemberId | null;
      const base = wake.review ? "reviewing" : wake.missionPlan ? "planning" : "thinking";
      showActivity(member.id, { kind: base, detail: null, from });
      const reply = await child.ask(
        prompt,
        (type, args, signal) =>
          decideRequest({
            provider: member.provider,
            memberId: member.id,
            proposeOnly: wake.proposeOnly,
            lock,
            // A member may also read the exact files attached to the message it answers.
            roots: [...roots, ...(wake.extras.attachments ?? [])],
            type,
            args,
            signal: signal ? AbortSignal.any([signal, abort!.signal]) : abort!.signal,
            onWaiting: (waiting) => {
              if (waiting) waitingLock.add(member.id);
              else waitingLock.delete(member.id);
              runtime.setMemberState(group.id, member.id, waiting ? "waiting" : "working");
              showActivity(member.id, { kind: waiting ? "waiting" : base, detail: null, from });
            },
          }),
        (delta, restart) => {
          if (!isStopped(member.id)) runtime.publishDraft(group.id, member.id, delta, restart);
        },
        (kind, detail) => {
          if (!isStopped(member.id)) showActivity(member.id, { kind, detail, from });
        },
      );
      return { reply, child };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        reply: { status: "failed", error: message, work: { files: [], commands: [] } },
        child: null,
      };
    }
  };

  const handOverFailure = (failed: GroupMember, wake: Wake) => {
    // A failed review is not handed on: the next member may be the author itself.
    if (wake.handedOver || replied || wake.review) return;
    const busy = [...running.keys()].some((id) => id !== failed.id);
    const queued = [...queues.entries()].some(
      ([id, queue]) => id !== failed.id && queue.length > 0,
    );
    if (busy || queued) return;
    const ordered = [...members.values()].toSorted((left, right) => left.position - right.position);
    const index = ordered.findIndex((entry) => entry.id === failed.id);
    const next = ordered
      .slice(index + 1)
      .concat(ordered.slice(0, index))
      .find((entry) => entry.id !== failed.id && !entry.muted);
    if (!next) return;
    useHop();
    enqueue({ ...wake, memberId: next.id, handedOver: true });
  };

  // One agent-started wake: a hand-off or an automatic review. Past the hop limit it waits
  // for the user's Continue.
  const handOff = (
    from: GroupMember,
    target: GroupMember,
    seq: number,
    text: string,
    proposeOnly: boolean,
    review: Wake["review"],
    replyId: string,
    mission: Wake["mission"],
  ) => {
    if (hops < settings.hopLimit) {
      useHop();
      enqueue({
        memberId: target.id,
        messageSeq: seq,
        fromLabel: from.handle,
        text,
        proposeOnly,
        allowPass: false,
        review,
        extras: {},
        handedOver: false,
        target: replyId,
        fromMemberId: from.id,
        mission,
        missionPlan: null,
      });
      return;
    }
    // The step waits for the user's Continue, so the mission pauses with it.
    if (mission) {
      const run = missionRuns.get(mission.missionId);
      if (run) run.paused = true;
    }
    pending.push({
      fromMemberId: from.id,
      toMemberId: target.id,
      text,
      targetId: replyId,
      ...(mission
        ? { mission: { missionId: mission.missionId as GroupMission["id"], step: mission.step } }
        : {}),
      ...(proposeOnly ? { proposeOnly: true } : {}),
      ...(review ? { reviewFiles: review.files } : {}),
    });
  };

  const settle = async (
    member: GroupMember,
    wake: Wake,
    reply: ChildReply,
    child: ChildSession | null,
    resetSeen: number,
  ): Promise<WakeOutcome> => {
    if (
      !members.has(member.id) ||
      reply.status === "stopped" ||
      aborts.get(member.id)?.signal.aborted ||
      // The user started this member fresh while it answered; the old session's reply is dropped.
      (resets.get(member.id) ?? 0) !== resetSeen
    ) {
      runtime.setMemberState(group.id, member.id, "idle");
      if (wake.missionPlan) await planFailed(wake.missionPlan);
      return "stopped";
    }
    const replyId = host.newId();
    // A review answer is not a proposal, even though the reviewer worked read-only.
    const isProposal = wake.proposeOnly && !wake.review;
    const record = (status: GroupReply["status"], error: string | null, passed = false) =>
      runtime.recordReply({
        groupId: group.id,
        replyId,
        memberId: member.id as GroupMemberId,
        status,
        error,
        files: reply.work.files,
        commands: reply.work.commands,
        ...(isProposal ? { proposeOnly: true } : {}),
        ...(passed ? { passed: true } : {}),
      });
    if (reply.status === "failed") {
      runtime.setMemberState(group.id, member.id, "failed");
      host.dropChild(member.id);
      await record("failed", reply.error);
      host.emitReply(member.id, replyId, reply.error);
      if (wake.missionPlan) await planFailed(wake.missionPlan);
      handOverFailure(member, wake);
      return "failed";
    }
    runtime.setMemberState(group.id, member.id, "idle");
    const usage = child?.contextUsage() ?? null;
    await runtime.saveMemberRuntime(member.id, {
      ...(child ? { nativeSessionId: child.nativeSessionId } : {}),
      readSeq: wake.messageSeq,
      setupRevSeen: settings.setupRev,
      ...(usage ? { contextUsage: usage } : {}),
    });
    // Only a member that was offered the pass may pass; one the user named is shown as it is.
    const passed = reply.status === "ok" && wake.allowPass && isPassReply(reply.text);
    if (reply.status === "empty" || !reply.text.trim() || passed) {
      // A pass stays out of the log, so nobody reads it in catch-up and nobody is woken by it.
      await record("empty", null, passed);
      host.emitReply(member.id, replyId, EMPTY_REPLY_TEXT);
      if (wake.missionPlan) await planFailed(wake.missionPlan);
      return passed ? "passed" : "empty";
    }
    replied = true;
    // An automatic review is not a turn in the conversation: a follow-up without @ goes to the
    // author, not to the reviewer with write access.
    if (!wake.review && !spoke.includes(member.id)) spoke.push(member.id);
    const seq = await runtime.appendLog(group.id, member.id, reply.text);
    host.emitReply(member.id, replyId, reply.text);
    await record("ok", null);
    if (wake.mission) {
      const run = missionRuns.get(wake.mission.missionId);
      if (run) {
        run.ok = true;
        for (const file of reply.work.files) run.files.add(file);
        run.commands += reply.work.commands.length;
        if (wake.review) run.reviews += 1;
        run.replies += 1;
      }
    }
    if (wake.missionPlan) {
      // A plan names every member; its mentions are steps, not hand-offs.
      await savePlan(wake.missionPlan, replyId, reply.text);
      return "ok";
    }
    // Mutes, the reviewer and the hop limit may have changed while this member worked.
    await refresh();
    const others = handles().filter((handle) => handle !== member.handle);
    const mentioned = parseGroupMentions(reply.text, others).handles;
    for (const handle of mentioned) {
      const target = byHandle(handle);
      // A muted member answers only the user; an agent's mention does not wake it.
      if (!target || target.muted) continue;
      // A reviewer's "@Author fix this" must let the author fix it.
      // A visiting agent is someone else's: what it hands over is a proposal, so the owner's
      // agents change nothing on its word alone.
      handOff(
        member,
        target,
        seq,
        reply.text,
        isProposal || Boolean(member.guestId),
        null,
        replyId,
        wake.mission,
      );
    }
    const reviewer = settings.reviewerMemberId ? members.get(settings.reviewerMemberId) : undefined;
    if (
      reviewer &&
      !reviewer.muted &&
      reviewer.id !== member.id &&
      !wake.proposeOnly &&
      reply.work.files.length > 0 &&
      !mentioned.includes(reviewer.handle)
    ) {
      handOff(
        member,
        reviewer,
        seq,
        reply.text,
        true,
        { authorHandle: member.handle, files: unique(reply.work.files) },
        replyId,
        wake.mission,
      );
    }
    return "ok";
  };

  async function drain(memberId: string): Promise<void> {
    running.set(memberId, null);
    try {
      for (;;) {
        const wake = queues.get(memberId)?.shift();
        if (!wake) break;
        // The member's model or mute may have changed since the wake was queued.
        await refresh();
        const member = members.get(memberId);
        if (!member) {
          await dropQueued(memberId, [wake]);
          break;
        }
        runtime.setMemberState(group.id, memberId, "working");
        aborts.set(memberId, new AbortController());
        // The member shows it picked the message up, then how it ended.
        if (wake.target) runtime.setReaction(group.id, wake.target, memberId, "seen");
        const resetSeen = resets.get(memberId) ?? 0;
        const { reply, child } = await ask(member, wake);
        lock.release(memberId);
        running.set(memberId, null);
        let outcome: WakeOutcome = "failed";
        try {
          outcome = await settle(member, wake, reply, child, resetSeen);
        } catch {
          // Saving the reply failed (storage error, or the group was deleted meanwhile).
          runtime.setMemberState(group.id, memberId, "failed");
        }
        showActivity(memberId, null);
        if (wake.target)
          runtime.setReaction(group.id, wake.target, memberId, OUTCOME_REACTION[outcome]);
        await closeMissionWake(wake, outcome);
      }
    } finally {
      running.delete(memberId);
      lock.release(memberId);
      await finishIfIdle();
    }
  }

  // Mission bookkeeping. A step's wakes are counted as they are queued and closed as they
  // settle; the last one to close ends the step.
  const dropQueued = async (memberId: string, extra: Wake[] = []) => {
    const dropped = [...extra, ...(queues.get(memberId) ?? [])];
    queues.set(memberId, []);
    for (const wake of dropped) {
      if (wake.target) runtime.setReaction(group.id, wake.target, memberId, null);
      await closeMissionWake(wake, "stopped");
    }
  };

  const closeMissionWake = async (wake: Wake, outcome: WakeOutcome) => {
    if (!wake.mission) return;
    const run = missionRuns.get(wake.mission.missionId);
    if (!run) return;
    if (outcome === "stopped") run.stopped = true;
    run.open -= 1;
    if (run.open <= 0) await stepFinished(wake.mission.missionId, run);
  };

  const saveMission = (mission: GroupMission) => runtime.saveMission(mission).catch(() => {});

  const stepFinished = async (missionId: string, run: MissionRun) => {
    missionRuns.delete(missionId);
    const mission = await runtime.loadMission(missionId);
    if (!mission) return;
    const index = mission.currentStep;
    const stats = addMissionStats(mission.stats, {
      files: [...run.files],
      commands: run.commands,
      reviews: run.reviews,
      replies: run.replies,
    });
    // Stopped by the user meanwhile: keep what was done and go no further.
    if (mission.status !== "running") return saveMission({ ...mission, stats });
    if (run.paused || run.stopped || !run.ok) {
      const stepStatus = run.paused || run.stopped ? "pending" : "failed";
      return saveMission({
        ...withStepStatus(mission, index, stepStatus),
        status: "paused",
        stats,
      });
    }
    const done = withStepStatus(mission, index, "done");
    const next = done.steps.findIndex(
      (step, position) => position > index && step.status === "pending",
    );
    if (next === -1) return saveMission({ ...done, status: "done", stats, finishedAt: Date.now() });
    await saveMission({ ...done, currentStep: next, stats });
    await startStep(missionId);
  };

  const startStep = async (missionId: string) => {
    const mission = await runtime.loadMission(missionId);
    if (!mission || mission.status !== "running") return;
    const index = mission.currentStep;
    const step = mission.steps[index];
    const member = step ? members.get(step.memberId) : undefined;
    if (!step || !member) {
      // The step's member left the group; the user can skip the step or stop.
      if (step)
        await saveMission({ ...withStepStatus(mission, index, "failed"), status: "paused" });
      return;
    }
    await saveMission(withStepStatus(mission, index, "running"));
    missionRuns.set(missionId, {
      open: 0,
      ok: false,
      stopped: false,
      paused: false,
      files: new Set(),
      commands: 0,
      reviews: 0,
      replies: 0,
    });
    // Every step gets its own hand-off budget.
    hops = 0;
    publishProgress();
    const seq = await runtime.appendLog(
      group.id,
      "user",
      `Mission step ${index + 1} of ${mission.steps.length} for @${member.handle}: ${step.text}`,
    );
    enqueue({
      memberId: member.id,
      messageSeq: seq,
      fromLabel: USER_LABEL,
      text: step.text,
      proposeOnly: false,
      allowPass: false,
      review: null,
      extras: {},
      handedOver: false,
      target: null,
      fromMemberId: null,
      mission: { missionId, step: index },
      missionPlan: null,
    });
  };

  const missionPrompt = async (tag: { missionId: string; step: number }) => {
    const mission = await runtime.loadMission(tag.missionId);
    if (!mission) return null;
    return {
      goal: mission.goal,
      index: tag.step,
      steps: mission.steps.map((step) => ({
        handle: label(step.memberId),
        text: step.text,
        status: step.status,
      })),
    };
  };

  const savePlan = async (missionId: string, replyId: string, text: string) => {
    const mission = await runtime.loadMission(missionId);
    if (!mission || mission.status !== "planning") return;
    const steps = parseMissionPlan(text, [...members.values()]);
    await saveMission({
      ...mission,
      planReplyId: replyId,
      steps,
      status: steps.length > 0 ? "ready" : "failed",
    });
  };

  const planFailed = async (missionId: string) => {
    const mission = await runtime.loadMission(missionId);
    if (mission?.status === "planning") await saveMission({ ...mission, status: "failed" });
  };

  // A Continue after a pause inside a mission step picks the mission up again.
  const resumeMission = async (missionId: string) => {
    if (missionRuns.has(missionId)) return;
    const mission = await runtime.loadMission(missionId);
    if (!mission || (mission.status !== "paused" && mission.status !== "running")) return;
    await saveMission({
      ...withStepStatus(mission, mission.currentStep, "running"),
      status: "running",
    });
    missionRuns.set(missionId, {
      open: 0,
      ok: false,
      stopped: false,
      paused: false,
      files: new Set(),
      commands: 0,
      reviews: 0,
      replies: 0,
    });
  };

  // A guest's message: the same routing as the owner's, but every agent it wakes can only
  // propose. It never resumes paused hand-offs, never counts as the owner's "@all" round, and
  // carries no attachments or skills, which only the owner may add.
  const handleGuestMessage = async (name: string, message: string, messageExtras: RoundExtras) => {
    const fromLabel = `${name}${GUEST_SUFFIX}`;
    const seq = await runtime.appendLog(group.id, fromLabel, message);
    const mentions = parseGroupMentions(message, handles(), ALL_ALIASES);
    const ordered = [...members.values()].toSorted((left, right) => left.position - right.position);
    const unmuted = ordered.filter((entry) => !entry.muted);
    const everyone = unmuted.length > 0 ? unmuted : ordered;
    const lead =
      settings.defaultRecipient !== "last" && settings.defaultRecipient !== "all"
        ? members.get(settings.defaultRecipient)
        : undefined;
    const lastSpeakers = (await runtime.roundState(group.id)).lastSpeakers.flatMap(
      (id) => members.get(id) ?? [],
    );
    const targets = mentions.all
      ? everyone
      : mentions.handles.length > 0
        ? mentions.handles.flatMap((handle) => byHandle(handle) ?? [])
        : lead
          ? [lead]
          : settings.defaultRecipient === "last" && lastSpeakers.length > 0
            ? lastSpeakers
            : everyone;
    for (const member of targets)
      enqueue({
        memberId: member.id,
        messageSeq: seq,
        fromLabel,
        text: message,
        proposeOnly: true,
        guest: name,
        allowPass: targets.length > 1,
        review: null,
        extras: { ...(messageExtras.messageId ? { messageId: messageExtras.messageId } : {}) },
        handedOver: false,
        target: messageExtras.messageId ?? null,
        fromMemberId: null,
        mission: null,
        missionPlan: null,
      });
  };

  const handleUserMessage = async (message: string, messageExtras: RoundExtras) => {
    await refresh();
    const guest = messageExtras.messageId
      ? await runtime.guestOf(group.id, messageExtras.messageId)
      : undefined;
    if (guest === null) return;
    if (guest) return handleGuestMessage(guest.name, message, messageExtras);
    const cue = messageExtras.messageId ? await runtime.takeCue(messageExtras.messageId) : null;
    const resumed = await runtime.takeResume(group.id);
    const seq = await runtime.appendLog(group.id, "user", message);
    if (cue?.kind === "missionStart") {
      await startStep(cue.missionId);
      return;
    }
    // The member reacts to the reacted reply, or to the user's own message.
    const target =
      cue?.kind === "reaction"
        ? cue.targetId
        : cue?.kind === "missionPlan"
          ? null
          : (messageExtras.messageId ?? null);
    if (resumed.length > 0) {
      lastRoundAll = resumed.some(
        (handoff) => handoff.proposeOnly === true && handoff.reviewFiles === undefined,
      );
      for (const handoff of resumed)
        if (handoff.mission) await resumeMission(handoff.mission.missionId);
      for (const handoff of resumed)
        enqueue({
          memberId: handoff.toMemberId,
          messageSeq: seq,
          fromLabel: label(handoff.fromMemberId),
          text: handoff.text,
          proposeOnly: handoff.proposeOnly === true,
          allowPass: false,
          review: handoff.reviewFiles
            ? { authorHandle: label(handoff.fromMemberId), files: [...handoff.reviewFiles] }
            : null,
          extras: messageExtras,
          handedOver: false,
          target: handoff.targetId ?? null,
          fromMemberId: handoff.fromMemberId,
          mission: handoff.mission ?? null,
          missionPlan: null,
        });
      return;
    }
    const mentions = parseGroupMentions(message, handles(), ALL_ALIASES);
    const ordered = [...members.values()].toSorted((left, right) => left.position - right.position);
    // Muted members sit out rounds that go to everyone, unless nobody else is left.
    const unmuted = ordered.filter((entry) => !entry.muted);
    const everyone = unmuted.length > 0 ? unmuted : ordered;
    const recipient = settings.defaultRecipient;
    const lead = recipient !== "last" && recipient !== "all" ? members.get(recipient) : undefined;
    let targets: GroupMember[];
    let proposeOnly: boolean;
    if (mentions.all) {
      targets = everyone;
      proposeOnly = true;
    } else if (mentions.handles.length > 0) {
      targets = mentions.handles.flatMap((handle) => byHandle(handle) ?? []);
      proposeOnly = false;
    } else if (lead) {
      targets = [lead];
      proposeOnly = false;
    } else if (recipient === "all") {
      targets = everyone;
      proposeOnly = true;
    } else {
      const previous = await runtime.roundState(group.id);
      const lastSpeakers = previous.lastSpeakers.flatMap((id) => members.get(id) ?? []);
      if (lastSpeakers.length > 0) {
        targets = lastSpeakers;
        proposeOnly = previous.lastRoundAll;
      } else {
        targets = everyone;
        proposeOnly = true;
      }
    }
    // A plan request only plans: nobody changes files and nobody passes.
    const missionPlan = cue?.kind === "missionPlan" ? cue.missionId : null;
    if (missionPlan) proposeOnly = true;
    lastRoundAll = proposeOnly && !missionPlan;
    for (const member of targets)
      enqueue({
        memberId: member.id,
        messageSeq: seq,
        fromLabel: USER_LABEL,
        text: message,
        proposeOnly,
        allowPass: !missionPlan && proposeOnly && targets.length > 1,
        review: null,
        extras: messageExtras,
        handedOver: false,
        target,
        fromMemberId: null,
        mission: null,
        missionPlan,
      });
    if (missionPlan && targets.length === 0) await planFailed(missionPlan);
  };

  const post = (message: string, messageExtras: RoundExtras = {}) => {
    if (finished) return false;
    chainBusy += 1;
    chain = chain
      .then(() => handleUserMessage(message, messageExtras))
      .catch(() => undefined)
      .finally(async () => {
        chainBusy -= 1;
        await finishIfIdle();
      });
    return true;
  };

  const stopMember = async (memberId: string) => {
    aborts.get(memberId)?.abort();
    await dropQueued(memberId);
    const child = running.get(memberId);
    if (child) await child.stop();
  };

  post(text, extras);

  return {
    post,
    stopMember,
    resetMember: async (memberId) => {
      resets.set(memberId, (resets.get(memberId) ?? 0) + 1);
      freshNext.add(memberId);
      aborts.get(memberId)?.abort();
      await dropQueued(memberId);
      // Closing the CLI first ends its turn at once; waiting for an interrupt could take long,
      // and a wake in that time would reuse the old session.
      host.dropChild(memberId);
    },
    removeMember: async (memberId) => {
      removed.add(memberId);
      members.delete(memberId);
      await stopMember(memberId);
      host.dropChild(memberId);
    },
    stopAll: async () => {
      await Promise.all([...members.keys()].map((memberId) => stopMember(memberId)));
      await finishIfIdle();
    },
    done,
  };
}

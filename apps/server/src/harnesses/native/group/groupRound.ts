// FILE: groupRound.ts
// Purpose: Routes one group "round": decides which members a message wakes, runs each member
//          in its own queue, follows agent-to-agent hand-offs up to the hop limit, hands a failed
//          sole task to the next member, and records what was said.
// Layer: Native harness (group)

import {
  GROUP_CATCH_UP_LIMIT,
  PROVIDER_DISPLAY_NAMES,
  type Group,
  type GroupHandoff,
  type GroupMember,
  type GroupMemberId,
  type GroupMemberState,
  type GroupReply,
} from "@djl/contracts";
import { parseGroupMentions } from "@djl/shared/groupChat";

import type { ChildReply, ChildSession } from "./childSession";
import { createWriteLock, decideRequest } from "./groupPolicy";
import { buildMemberPrompt, selectMissed, type PromptMember } from "./groupPrompt";

// Localized spellings of @all that users type in Chinese group chats.
const ALL_ALIASES = ["所有人", "全体成员", "全体"];
const USER_LABEL = "User";
const EMPTY_REPLY_TEXT = "…";

export interface GroupRuntime {
  loadGroup(threadId: string): Promise<Group | null>;
  appendLog(groupId: string, author: "user" | string, text: string): Promise<number>;
  logAfter(groupId: string, seq: number): Promise<{ seq: number; author: string; text: string }[]>;
  memberRuntime(memberId: string): Promise<{ nativeSessionId: string | null; readSeq: number }>;
  saveMemberRuntime(
    memberId: string,
    patch: { nativeSessionId?: string | null; readSeq?: number },
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
}

export type RoundExtras = {
  attachments?: string[];
  pastedSkills?: { name: string; markdown: string }[];
};

export interface Round {
  post(text: string, extras?: RoundExtras): void;
  stopMember(memberId: string): Promise<void>;
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
  extras: RoundExtras;
  /** The task was already handed over once after a failure. */
  handedOver: boolean;
}

export function startRound(
  host: RoundHost,
  group: Group,
  text: string,
  extras: RoundExtras = {},
): Round {
  const { runtime } = host;
  const members = new Map<string, GroupMember>(group.members.map((entry) => [entry.id, entry]));
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

  const label = (author: string) =>
    author === "user" ? USER_LABEL : (members.get(author)?.handle ?? "Removed agent");
  const handles = () => [...members.values()].map((entry) => entry.handle);
  const byHandle = (handle: string) =>
    [...members.values()].find((entry) => entry.handle === handle);

  const finishIfIdle = async () => {
    if (finished || chainBusy > 0 || running.size > 0) return;
    if ([...queues.values()].some((queue) => queue.length > 0)) return;
    finished = true;
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
    }));

  const openFor = async (member: GroupMember) => {
    const saved = await runtime.memberRuntime(member.id);
    if (saved.nativeSessionId) {
      try {
        return { child: await host.openChild(member, saved.nativeSessionId), fresh: false, saved };
      } catch {
        // The saved session cannot be resumed (expired, or the CLI cannot load sessions).
        host.dropChild(member.id);
      }
    }
    return { child: await host.openChild(member, null), fresh: true, saved };
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
        groupName: group.name,
        self: promptMembers().find((entry) => entry.id === member.id)!,
        members: promptMembers(),
        skills: fresh ? await runtime.skills() : [],
        briefing: fresh,
        missed,
        skipped,
        message: { fromLabel: wake.fromLabel, text: wake.text },
        proposeOnly: wake.proposeOnly,
        attachments: wake.extras.attachments ?? [],
        pastedSkills: wake.extras.pastedSkills ?? [],
      });
      const abort = aborts.get(member.id);
      if (isStopped(member.id)) return { reply: stoppedReply, child: null };
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
            onWaiting: (waiting) =>
              runtime.setMemberState(group.id, member.id, waiting ? "waiting" : "working"),
          }),
        (delta, restart) => {
          if (!isStopped(member.id)) runtime.publishDraft(group.id, member.id, delta, restart);
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
    if (wake.handedOver || replied) return;
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
      .find((entry) => entry.id !== failed.id);
    if (!next) return;
    hops += 1;
    enqueue({ ...wake, memberId: next.id, handedOver: true });
  };

  const settle = async (
    member: GroupMember,
    wake: Wake,
    reply: ChildReply,
    child: ChildSession | null,
  ) => {
    if (
      !members.has(member.id) ||
      reply.status === "stopped" ||
      aborts.get(member.id)?.signal.aborted
    ) {
      runtime.setMemberState(group.id, member.id, "idle");
      return;
    }
    const replyId = host.newId();
    const record = (status: GroupReply["status"], error: string | null) =>
      runtime.recordReply({
        groupId: group.id,
        replyId,
        memberId: member.id as GroupMemberId,
        status,
        error,
        files: reply.work.files,
        commands: reply.work.commands,
      });
    if (reply.status === "failed") {
      runtime.setMemberState(group.id, member.id, "failed");
      host.dropChild(member.id);
      await record("failed", reply.error);
      host.emitReply(member.id, replyId, reply.error);
      handOverFailure(member, wake);
      return;
    }
    runtime.setMemberState(group.id, member.id, "idle");
    await runtime.saveMemberRuntime(member.id, {
      ...(child ? { nativeSessionId: child.nativeSessionId } : {}),
      readSeq: wake.messageSeq,
    });
    if (reply.status === "empty" || !reply.text.trim()) {
      await record("empty", null);
      host.emitReply(member.id, replyId, EMPTY_REPLY_TEXT);
      return;
    }
    replied = true;
    if (!spoke.includes(member.id)) spoke.push(member.id);
    const seq = await runtime.appendLog(group.id, member.id, reply.text);
    host.emitReply(member.id, replyId, reply.text);
    await record("ok", null);
    const others = handles().filter((handle) => handle !== member.handle);
    for (const handle of parseGroupMentions(reply.text, others).handles) {
      const target = byHandle(handle);
      if (!target) continue;
      if (hops < group.hopLimit) {
        hops += 1;
        enqueue({
          memberId: target.id,
          messageSeq: seq,
          fromLabel: member.handle,
          text: reply.text,
          proposeOnly: wake.proposeOnly,
          extras: {},
          handedOver: false,
        });
      } else {
        pending.push({
          fromMemberId: member.id as GroupMemberId,
          toMemberId: target.id,
          text: reply.text,
          ...(wake.proposeOnly ? { proposeOnly: true } : {}),
        });
      }
    }
  };

  async function drain(memberId: string): Promise<void> {
    running.set(memberId, null);
    try {
      for (;;) {
        const wake = queues.get(memberId)?.shift();
        const member = members.get(memberId);
        if (!wake || !member) break;
        runtime.setMemberState(group.id, memberId, "working");
        aborts.set(memberId, new AbortController());
        const { reply, child } = await ask(member, wake);
        lock.release(memberId);
        running.set(memberId, null);
        try {
          await settle(member, wake, reply, child);
        } catch {
          // Saving the reply failed (storage error, or the group was deleted meanwhile).
          runtime.setMemberState(group.id, memberId, "failed");
        }
      }
    } finally {
      running.delete(memberId);
      lock.release(memberId);
      await finishIfIdle();
    }
  }

  const handleUserMessage = async (message: string, messageExtras: RoundExtras) => {
    const resumed = await runtime.takeResume(group.id);
    const seq = await runtime.appendLog(group.id, "user", message);
    if (resumed.length > 0) {
      lastRoundAll = resumed.some((handoff) => handoff.proposeOnly === true);
      for (const handoff of resumed)
        enqueue({
          memberId: handoff.toMemberId,
          messageSeq: seq,
          fromLabel: label(handoff.fromMemberId),
          text: handoff.text,
          proposeOnly: handoff.proposeOnly === true,
          extras: messageExtras,
          handedOver: false,
        });
      return;
    }
    const mentions = parseGroupMentions(message, handles(), ALL_ALIASES);
    const ordered = [...members.values()].toSorted((left, right) => left.position - right.position);
    let targets: GroupMember[];
    let proposeOnly: boolean;
    if (mentions.all) {
      targets = ordered;
      proposeOnly = true;
    } else if (mentions.handles.length > 0) {
      targets = mentions.handles.flatMap((handle) => byHandle(handle) ?? []);
      proposeOnly = false;
    } else {
      const previous = await runtime.roundState(group.id);
      const lastSpeakers = previous.lastSpeakers.flatMap((id) => members.get(id) ?? []);
      if (lastSpeakers.length > 0) {
        targets = lastSpeakers;
        proposeOnly = previous.lastRoundAll;
      } else {
        targets = ordered;
        proposeOnly = true;
      }
    }
    lastRoundAll = proposeOnly;
    for (const target of targets)
      enqueue({
        memberId: target.id,
        messageSeq: seq,
        fromLabel: USER_LABEL,
        text: message,
        proposeOnly,
        extras: messageExtras,
        handedOver: false,
      });
  };

  const post = (message: string, messageExtras: RoundExtras = {}) => {
    chainBusy += 1;
    chain = chain
      .then(() => handleUserMessage(message, messageExtras))
      .catch(() => undefined)
      .finally(async () => {
        chainBusy -= 1;
        await finishIfIdle();
      });
  };

  const stopMember = async (memberId: string) => {
    queues.set(memberId, []);
    aborts.get(memberId)?.abort();
    const child = running.get(memberId);
    if (child) await child.stop();
  };

  post(text, extras);

  return {
    post,
    stopMember,
    removeMember: async (memberId) => {
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

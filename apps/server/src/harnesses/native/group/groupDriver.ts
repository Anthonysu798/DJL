// FILE: groupDriver.ts
// Purpose: The native driver behind a Multi agents group thread. Each turn is one round: it
//          opens a child driver per member as needed, routes the message, and posts each
//          member's final answer into the thread as its own assistant message.
// Layer: Native harness (group)

import type {
  ChatAttachment,
  GroupMember,
  GroupMemberId,
  GroupMemberProvider,
  ModelSelection,
  ProviderSendTurnInput,
  ProviderStartOptions,
} from "@djl/contracts";
import { formatGroupItemId } from "@djl/shared/groupChat";
import { randomUUID } from "node:crypto";

import type { GroupDriverRuntime } from "../../../groups/Services/GroupDriverBridge";
import type { NativeDriverFactory } from "../types";
import { openChildSession, type ChildSession } from "./childSession";
import { startRound, type Round, type RoundExtras, type RoundHost } from "./groupRound";

export const GROUP_MODELS = [{ slug: "group", name: "Group" }];

export function createGroupDriverFactory(deps: {
  bridge: () => GroupDriverRuntime | null;
  childFactories: Record<GroupMemberProvider, NativeDriverFactory>;
  childOptions: (provider: GroupMemberProvider) => Promise<ProviderStartOptions>;
  resolveAttachment: (attachment: ChatAttachment) => string | null;
  readSkill: (path: string) => Promise<string>;
}): NativeDriverFactory {
  // The group's plugin access is shared by its members: they all work for the same user.
  return async (input, sink, _workTools, plugins) => {
    const children = new Map<string, ChildSession>();
    let round: Round | null = null;
    // Set while `send` prepares the round, so a steer in that gap waits for it.
    let starting: Promise<Round | null> | null = null;
    const bridge = deps.bridge();
    const known = bridge ? await bridge.runtime.loadGroup(input.threadId) : null;

    // Bumped whenever a member's CLI is dropped, so one still starting is closed, not kept.
    const generations = new Map<string, number>();
    const closeChild = (memberId: string) => {
      generations.set(memberId, (generations.get(memberId) ?? 0) + 1);
      children.get(memberId)?.close();
      children.delete(memberId);
    };
    const closeAll = () => {
      for (const memberId of children.keys()) closeChild(memberId);
    };

    const unregister = known
      ? bridge!.registerLive(input.threadId, {
          stopMember: async (memberId: GroupMemberId) => {
            await round?.stopMember(memberId);
          },
          removeMember: async (memberId: GroupMemberId) => {
            if (round) await round.removeMember(memberId);
            closeChild(memberId);
          },
          resetSessions: async () => {
            await round?.stopAll();
            closeAll();
          },
        })
      : () => {};

    const roundExtras = async (turn: ProviderSendTurnInput): Promise<RoundExtras> => ({
      attachments: (turn.attachments ?? []).flatMap(
        (attachment) => deps.resolveAttachment(attachment) ?? [],
      ),
      pastedSkills: await Promise.all(
        (turn.skills ?? []).map(async (skill) => ({
          name: skill.name,
          markdown: await deps.readSkill(skill.path),
        })),
      ),
    });

    const openChild = async (member: GroupMember, resume: string | null, cwd: string) => {
      const existing = children.get(member.id);
      if (existing) return existing;
      const generation = generations.get(member.id) ?? 0;
      const modelSelection = member.model
        ? ({ provider: member.provider, model: member.model } as ModelSelection)
        : undefined;
      const child = await openChildSession({
        provider: member.provider,
        factory: deps.childFactories[member.provider],
        ...(plugins ? { plugins } : {}),
        start: {
          threadId: input.threadId,
          provider: member.provider,
          cwd,
          runtimeMode: "approval-required",
          providerOptions: await deps.childOptions(member.provider),
          ...(modelSelection ? { modelSelection } : {}),
          ...(resume ? { resumeCursor: { nativeSessionId: resume } } : {}),
        },
      });
      if ((generations.get(member.id) ?? 0) !== generation) {
        child.close();
        throw new Error("This member was stopped while it was starting.");
      }
      children.set(member.id, child);
      return child;
    };

    return {
      id: `group-${input.threadId}`,
      async send(turn) {
        const runtime = deps.bridge();
        if (!runtime) throw new Error("Multi agents is still starting. Try again in a moment.");
        const ready = Promise.withResolvers<Round | null>();
        starting = ready.promise;
        const group = await runtime.runtime.loadGroup(turn.threadId).catch((error) => {
          ready.resolve(null);
          throw error;
        });
        if (!group) {
          ready.resolve(null);
          throw new Error("This group no longer exists.");
        }
        const extras = await roundExtras(turn).catch((error) => {
          ready.resolve(null);
          throw error;
        });
        const host: RoundHost = {
          runtime: runtime.runtime,
          openChild: (member, resume) => openChild(member, resume, group.folder),
          dropChild: closeChild,
          emitReply: (memberId, replyId, text) => {
            const itemId = formatGroupItemId(memberId, replyId);
            // The delta must come first: a completion without one can attach to another
            // member's open message during ingestion.
            sink.emit({
              type: "content.delta",
              itemId,
              payload: { streamKind: "assistant_text", delta: text },
            });
            sink.emit({
              type: "item.completed",
              itemId,
              payload: { itemType: "assistant_message", status: "completed" },
            });
          },
          newId: () => randomUUID().replaceAll("-", ""),
          readRoots: runtime.readRoots,
        };
        const current = startRound(host, group, turn.input ?? "", extras);
        round = current;
        ready.resolve(current);
        try {
          await current.done;
        } finally {
          if (round === current) round = null;
          if (starting === ready.promise) starting = null;
        }
      },
      async steer(turn) {
        const target = round ?? (starting ? await starting : null);
        if (!target || target !== round) return false;
        target.post(turn.input ?? "", await roundExtras(turn));
        return true;
      },
      async interrupt() {
        await round?.stopAll();
      },
      close() {
        void round?.stopAll();
        closeAll();
        unregister();
      },
      models: async () => ({ models: GROUP_MODELS, source: "group" }),
    };
  };
}

// FILE: GroupDriverBridge.ts
// Purpose: Lets the group harness (built in the provider layer) reach the GroupService (built in
//          the runtime layer, which depends on the provider layer). GroupService attaches itself
//          when it starts; the group driver reads it when a turn runs.
// Layer: Service

import type { ThreadId } from "@synara/contracts";
import { Layer, ServiceMap } from "effect";

import type { GroupRuntime } from "../../harnesses/native/group/groupRound";
import type { GroupLiveControls } from "./GroupService";

export interface GroupDriverRuntime {
  readonly runtime: GroupRuntime;
  readonly registerLive: (threadId: ThreadId, controls: GroupLiveControls) => () => void;
  /** Extra folders members may read without asking: skills folders and attachments. */
  readonly readRoots: readonly string[];
}

export interface GroupDriverBridgeShape {
  attach(runtime: GroupDriverRuntime): void;
  current(): GroupDriverRuntime | null;
}

export class GroupDriverBridge extends ServiceMap.Service<
  GroupDriverBridge,
  GroupDriverBridgeShape
>()("djl/groups/GroupDriverBridge") {}

export function makeGroupDriverBridge(): GroupDriverBridgeShape {
  let attached: GroupDriverRuntime | null = null;
  return {
    attach: (runtime) => {
      attached = runtime;
    },
    current: () => attached,
  };
}

export const GroupDriverBridgeLive = Layer.sync(GroupDriverBridge, makeGroupDriverBridge);

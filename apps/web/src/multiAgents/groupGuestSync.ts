// FILE: groupGuestSync.ts
// Purpose: Keeps the desktop's guest connections in step with the guest lists of all groups,
//          from app start on, and shares their live state (invite code, connected or not).
// Layer: Web logic + hooks

import type { DesktopGroupGuestInvite, DesktopGroupGuestLink, Group } from "@djl/contracts";
import { useEffect, useSyncExternalStore } from "react";

import { ensureNativeApi } from "~/nativeApi";

/** Every guest of every group, as the desktop needs them to open a connection. */
export function collectGuestInvites(groups: Iterable<Group>): DesktopGroupGuestInvite[] {
  return [...groups]
    .flatMap((group) =>
      (group.guests ?? []).map((guest) => ({
        guestId: guest.id,
        groupId: group.id,
        threadId: group.threadId,
        groupName: group.name,
        name: guest.name,
        role: guest.role,
      })),
    )
    .toSorted((left, right) => left.guestId.localeCompare(right.guestId));
}

let links: readonly DesktopGroupGuestLink[] = [];
const listeners = new Set<() => void>();
const setLinks = (next: readonly DesktopGroupGuestLink[]) => {
  links = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The live state of every guest connection the desktop holds. */
export function useGroupGuestLinks(): readonly DesktopGroupGuestLink[] {
  return useSyncExternalStore(
    subscribe,
    () => links,
    () => links,
  );
}

/** Asks the desktop for a fresh invite code for one guest. */
export async function renewGroupGuestInvite(guestId: string): Promise<void> {
  const next = await window.desktopBridge?.remote.renewGroupGuestInvite?.(guestId);
  if (next) setLinks(next);
}

/**
 * Mounted once at the app's root: follows the groups and tells the desktop which guests exist.
 * It keeps its own small copy of the groups, because the Multi agents screen's store is only
 * filled while that screen is open, and a guest must be able to connect at any time.
 */
export function useGroupGuestSync(): void {
  useEffect(() => {
    const bridge = window.desktopBridge?.remote;
    if (!bridge?.syncGroupGuests) return;
    const groups = new Map<string, Group>();
    let last = "";
    let active = true;
    const sync = () => {
      const invites = collectGuestInvites(groups.values());
      const key = JSON.stringify(invites);
      if (key === last) return;
      last = key;
      void bridge.syncGroupGuests?.(invites).then(
        (next) => {
          if (active) setLinks(next);
        },
        () => undefined,
      );
    };
    const offLinks = bridge.onGroupGuests?.((next) => setLinks(next));
    const api = ensureNativeApi();
    const offEvents = api.groups.onEvent((event) => {
      if (event.type === "snapshot") {
        groups.clear();
        for (const group of event.groups) groups.set(group.id, group);
      } else if (event.type === "group.upserted") groups.set(event.group.id, event.group);
      else if (event.type === "group.deleted") groups.delete(event.groupId);
      else return;
      sync();
    });
    void api.groups.list().then(
      (result) => {
        if (!active) return;
        for (const group of result.groups) groups.set(group.id, group);
        sync();
      },
      () => undefined,
    );
    return () => {
      active = false;
      offLinks?.();
      offEvents();
    };
  }, []);
}

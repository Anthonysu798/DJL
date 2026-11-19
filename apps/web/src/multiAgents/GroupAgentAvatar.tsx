// FILE: GroupAgentAvatar.tsx
// Purpose: The small rounded tile that stands for an agent everywhere in Multi agents, and the
//          overlapping stack of tiles that stands for a group.
// Layer: UI component

import type { GroupMember } from "@synara/contracts";
import type { CSSProperties } from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { cn } from "~/lib/utils";

const SIZES = {
  xs: { tile: "size-5 rounded-md", icon: "size-3" },
  sm: { tile: "size-6 rounded-[7px]", icon: "size-3.5" },
  md: { tile: "size-7 rounded-lg", icon: "size-4" },
} as const;

export function GroupAgentAvatar(props: {
  provider: GroupMember["provider"];
  size?: keyof typeof SIZES;
  className?: string;
  style?: CSSProperties;
}) {
  const size = SIZES[props.size ?? "md"];
  return (
    <span
      style={props.style}
      className={cn(
        "flex shrink-0 items-center justify-center border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)]",
        size.tile,
        props.className,
      )}
    >
      <ProviderIcon provider={props.provider} className={size.icon} />
    </span>
  );
}

/** Up to three member tiles, overlapped; the ring keeps each tile's edge readable. */
export function GroupAvatarStack(props: {
  members: readonly GroupMember[];
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 -space-x-1.5", props.className)}>
      {props.members.slice(0, 3).map((member) => (
        <GroupAgentAvatar
          key={member.id}
          provider={member.provider}
          size={props.size ?? "xs"}
          className="ring-2 ring-background"
        />
      ))}
    </span>
  );
}

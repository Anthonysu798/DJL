// FILE: TerminalIdentityIcon.tsx
// Purpose: Renders a terminal/provider icon without extra activity chrome.
// Layer: Terminal presentation primitive
// Depends on: shared terminal icon keys plus local provider/icon components.

import type { TerminalIconKey } from "@synara/shared/terminalThreads";

import { TerminalSquare } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { ClaudeAI, OpenAI, CursorIcon, OpenCodeIcon, KimiIcon, GrokIcon } from "../Icons";

interface TerminalIdentityIconProps {
  iconKey: TerminalIconKey;
  className?: string;
}

// Keep provider branding reusable across every terminal surface.
export default function TerminalIdentityIcon({ iconKey, className }: TerminalIdentityIconProps) {
  const IconComponent = {
    openai: OpenAI,
    claude: ClaudeAI,
    cursor: CursorIcon,
    opencode: OpenCodeIcon,
    kimi: KimiIcon,
    grok: GrokIcon,
    terminal: TerminalSquare,
  }[iconKey];

  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)}>
      <IconComponent className={cn("size-full text-[var(--color-text-foreground)]")} />
    </span>
  );
}

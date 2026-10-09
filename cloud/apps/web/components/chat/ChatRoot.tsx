"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AuthGate } from "@/components/AuthGate";
import { chatClient, MOCK_API } from "@/lib/chat/api";
import { ChatProvider } from "@/lib/chat/context";

import { ChatShell } from "./ChatShell";

/** Signed-in chat area. The mock API has no sessions, so it skips the gate. */
export function ChatRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/chat";
  const content = (
    <ChatProvider client={chatClient}>
      <ChatShell>{children}</ChatShell>
    </ChatProvider>
  );
  if (MOCK_API) return content;
  return <AuthGate next={pathname}>{content}</AuthGate>;
}

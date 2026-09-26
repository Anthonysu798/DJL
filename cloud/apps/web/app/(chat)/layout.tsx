import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ChatRoot } from "@/components/chat/ChatRoot";

export const metadata: Metadata = { title: "DJL", robots: { index: false, follow: false } };

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <ChatRoot>{children}</ChatRoot>;
}

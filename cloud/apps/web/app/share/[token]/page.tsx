import type { Metadata } from "next";

import { SharedConversation } from "@/components/chat/SharedConversation";

export const metadata: Metadata = {
  title: "DJL",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  referrer: "no-referrer",
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedConversation token={decodeURIComponent(token)} />;
}

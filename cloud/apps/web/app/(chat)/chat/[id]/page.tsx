"use client";
import { useParams } from "next/navigation";

import { ChatView } from "@/components/chat/ChatView";

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const conversationId = decodeURIComponent(id);
  return <ChatView key={conversationId} conversationId={conversationId} />;
}

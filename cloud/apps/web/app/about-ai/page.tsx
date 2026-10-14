import Link from "next/link";
import { AiNotice } from "@/components/AiNotice";
export default function AboutAi() {
  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-medium tracking-tight">Using DJL responsibly</h1>
      <p className="leading-7 text-muted-foreground">
        DJL uses AI models to respond to your questions. AI can make mistakes. Check important
        information and don’t share sensitive personal, financial, or confidential information in
        your chats.
      </p>
      <AiNotice />
      <Link href="/chat" className="btn-secondary">
        Back to DJL
      </Link>
    </article>
  );
}

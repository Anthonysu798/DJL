import Link from "next/link";

export function AiNotice() {
  return (
    <p className="ai-notice text-center text-[11px] leading-[1.55] text-neutral-500">
      DJL is AI. By using it, you agree to our <a href={"https://slcor.com/terms"}>Terms</a> &amp;{" "}
      <a href={"https://slcor.com/privacy"}>Privacy Policy</a>. Don’t share sensitive info. Chats
      may be reviewed and used to improve our AI models. <Link href="/about-ai">Learn more</Link>
    </p>
  );
}

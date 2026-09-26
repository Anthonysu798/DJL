"use client";
import { Check, Copy } from "lucide-react";
import { memo, useRef, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { useLocale } from "@/lib/locale-context";

import { useCopy } from "./useCopy";

function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, copy] = useCopy();
  const { d } = useLocale();
  const child = Array.isArray(children) ? children[0] : children;
  const className =
    (child as { props?: { className?: string } } | undefined)?.props?.className ?? "";
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? "";
  return (
    <div className="not-prose overflow-hidden rounded-xl border border-border bg-code-bg">
      <div className="flex h-9 items-center justify-between border-b border-border pr-1.5 pl-4 text-xs text-muted-foreground">
        <span className="font-mono">{language || "text"}</span>
        <button
          type="button"
          onClick={() => void copy(ref.current?.textContent ?? "")}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? d.chat.copied : d.chat.copyCode}
        </button>
      </div>
      <pre ref={ref} {...props} className="overflow-x-auto p-4 font-mono text-[13px] leading-6">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),
  // No remote images from model output: they could track the reader.
  img: ({ node: _node, src, alt }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow">
        {alt || src}
      </a>
    ) : null,
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

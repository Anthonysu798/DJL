"use client";
import type {
  CloudMessagePart,
  CloudToolCallPart,
  CloudToolResultPart,
} from "@synara/contracts/cloud";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  FileText,
  Globe,
  ImageIcon,
  Loader2,
  Search,
  Square,
  Wrench,
} from "lucide-react";
import { useState } from "react";

import { isTerminal } from "@/lib/chat/runs";
import type { RunView } from "@/lib/chat/store";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

interface Step {
  readonly call: CloudToolCallPart;
  readonly result: CloudToolResultPart | null;
}

export function toolSteps(parts: readonly CloudMessagePart[]): Step[] {
  const results = new Map<string, CloudToolResultPart>();
  for (const p of parts) if (p.type === "tool_result") results.set(p.toolCallId, p);
  return parts
    .filter((p): p is CloudToolCallPart => p.type === "tool_call")
    .map((call) => ({ call, result: results.get(call.toolCallId) ?? null }));
}

const ICONS: Record<string, typeof Search> = {
  web_search: Search,
  read_page: Globe,
  python: Code2,
  generate_image: ImageIcon,
  edit_image: ImageIcon,
  read_file: FileText,
};

function args(call: CloudToolCallPart): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(call.arguments);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const urlsIn = (text: string) =>
  [...new Set(text.match(/https?:\/\/[^\s)>\]"']+/g) ?? [])].slice(0, 6);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Live list of what a task run is doing: searches, pages read, code runs, and a completion state. */
export function TaskSteps({
  parts,
  run,
}: {
  parts: readonly CloudMessagePart[];
  run: RunView | undefined;
}) {
  const { d } = useLocale();
  const steps = toolSteps(parts);
  const running = run ? !isTerminal(run.status) : false;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? running;
  if (steps.length === 0 && !(running && run?.mode === "task")) return null;

  const status = run?.status;
  const used =
    steps.length === 1 ? d.chat.toolUsed : fill(d.chat.toolsUsed, { count: String(steps.length) });
  // Without a run (history, shared snapshots) all we know is which tools ran.
  const headline = running
    ? d.chat.working
    : status === "cancelled"
      ? d.chat.taskStopped
      : status === "failed"
        ? d.chat.taskFailed
        : status === "succeeded"
          ? d.chat.taskDone
          : used;
  const StatusIcon = running
    ? Loader2
    : status === "failed"
      ? CircleAlert
      : status === "cancelled"
        ? Square
        : Check;

  return (
    <section className="rounded-xl border border-border bg-card" aria-label={headline}>
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
      >
        <StatusIcon
          className={cn(
            "size-4 shrink-0",
            running
              ? "animate-spin text-primary"
              : status === "failed"
                ? "text-danger-fg"
                : "text-success-fg",
          )}
          aria-hidden
        />
        <span className="font-medium">{headline}</span>
        {running && run?.step && run.maxSteps ? (
          <span className="text-muted-foreground tabular-nums">
            · {fill(d.chat.stepOf, { step: String(run.step), max: String(run.maxSteps) })}
          </span>
        ) : status && !running && steps.length > 0 ? (
          <span className="text-muted-foreground">· {used}</span>
        ) : null}
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ol
          className="space-y-3 border-t border-border px-3.5 py-3"
          aria-live={running ? "polite" : "off"}
        >
          {steps.map(({ call, result }) => (
            <StepRow key={call.toolCallId} call={call} result={result} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function StepRow({ call, result }: Step) {
  const { d } = useLocale();
  const labels = (d.chat.tools as Record<string, { running: string; done: string }>)[call.name];
  const label = labels
    ? result
      ? labels.done
      : labels.running
    : fill(d.chat.toolFallback, { name: call.name });
  const Icon = ICONS[call.name] ?? Wrench;
  const a = args(call);
  const sources = result && call.name === "web_search" ? urlsIn(result.content) : [];
  return (
    <li className="flex gap-3 text-sm">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border",
          result?.isError ? "text-danger-fg" : "text-muted-foreground",
        )}
      >
        {result ? (
          <Icon className="size-3.5" aria-hidden />
        ) : (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="leading-6">
          <span className="font-medium">{label}</span>
          {typeof a.query === "string" ? (
            <span className="text-muted-foreground"> · “{a.query}”</span>
          ) : null}
          {typeof a.url === "string" ? (
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              {" "}
              · {host(a.url)}
            </a>
          ) : null}
        </p>
        {sources.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label={d.chat.sources}>
            {sources.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Globe className="size-3 shrink-0" aria-hidden />
                {host(url)}
              </a>
            ))}
          </div>
        ) : null}
        {typeof a.code === "string" ? (
          <pre
            className="overflow-x-auto rounded-lg bg-code-bg p-2.5 font-mono text-xs leading-5"
            aria-label={d.chat.code}
          >
            {a.code}
          </pre>
        ) : null}
        {result && call.name === "python" ? (
          <pre
            className="overflow-x-auto rounded-lg border border-border p-2.5 font-mono text-xs leading-5 text-muted-foreground"
            aria-label={d.chat.output}
          >
            {result.content}
          </pre>
        ) : result && call.name !== "web_search" ? (
          <p className={cn("text-xs", result.isError ? "text-danger-fg" : "text-muted-foreground")}>
            {result.content}
          </p>
        ) : null}
      </div>
    </li>
  );
}

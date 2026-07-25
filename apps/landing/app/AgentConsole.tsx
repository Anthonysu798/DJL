"use client";

import { useState } from "react";
import { Check, Terminal } from "lucide-react";
import type { Content, ConsoleTab } from "./content";
import { codeLines } from "./content";
import { Lens } from "./ui/lens";

export function AgentConsole({ c, initialTab }: { c: Content["console"]; initialTab: ConsoleTab }) {
  const [tab, setTab] = useState<ConsoleTab>(initialTab);
  const activeIndex = tab === "plan" ? 2 : tab === "tools" ? 4 : 5;
  const r = c.review;

  return (
    <div className="panel relative overflow-hidden rounded-[14px] shadow-[0_50px_120px_-60px_rgba(255,138,61,0.5)]">
      {/* top glow line */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(255,180,84,0.7), transparent)",
        }}
      />

      {/* header */}
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="flex items-center gap-3">
          <span className="font-display text-[17px] font-bold tracking-tight">DJL</span>
          <span className="chip">
            <span className="dot dot-amber" style={{ animation: "blink 1.4s steps(1) infinite" }} />
            {c.tag}
          </span>
        </div>
        <div
          className="flex rounded-md border p-0.5 text-[12px] font-semibold"
          style={{ borderColor: "var(--line-2)" }}
          role="tablist"
        >
          {c.tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className="rounded px-3.5 py-1.5 transition-colors"
              style={
                tab === t.id
                  ? { background: "var(--amber)", color: "#160c00" }
                  : { color: "var(--mute)" }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* body */}
      <div className="grid lg:grid-cols-[230px_1fr_270px]">
        {/* timeline */}
        <div
          className="border-b p-5 lg:border-b-0 lg:border-r"
          style={{ borderColor: "var(--line)" }}
        >
          <h3 className="text-[15px] font-semibold leading-snug text-[color:var(--paper)]">
            {c.task}
          </h3>
          <div className="chip mt-3">
            <span className="dot dot-azure" />
            {c.state}
          </div>
          <div className="mt-6">
            {c.timeline.map(([title, body], i) => {
              const complete = i < activeIndex;
              const active = i === activeIndex;
              const last = i === c.timeline.length - 1;
              return (
                <div
                  key={title}
                  className="relative grid grid-cols-[20px_1fr] gap-3 pb-5 last:pb-0"
                >
                  {!last && (
                    <span
                      className="absolute left-[9px] top-5 h-full w-px"
                      style={{ background: "var(--line-2)" }}
                    />
                  )}
                  <span
                    className="relative z-10 mt-0.5 grid h-[19px] w-[19px] place-items-center rounded-full border"
                    style={{
                      borderColor: active
                        ? "var(--azure)"
                        : complete
                          ? "var(--amber)"
                          : "var(--mute-2)",
                      background: active
                        ? "var(--azure)"
                        : complete
                          ? "var(--amber)"
                          : "transparent",
                    }}
                  >
                    {complete && <Check className="h-3 w-3 text-[#0a0c13]" />}
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-[#0a0c13]" />}
                  </span>
                  <div>
                    <div className="font-mono text-[12px] font-semibold uppercase tracking-wider text-[color:var(--paper)]">
                      {title}
                    </div>
                    <div className="font-mono mt-0.5 text-[11px] text-[color:var(--mute)]">
                      {body}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* code + terminal */}
        <div
          className="space-y-3 border-b p-5 lg:border-b-0 lg:border-r"
          style={{ borderColor: "var(--line)" }}
        >
          <Lens zoomFactor={1.7} lensSize={150}>
            <div className="panel-inset overflow-hidden p-4">
              <div className="font-mono mb-3 flex items-center justify-between text-[11px] text-[color:var(--mute)]">
                <span>{c.file}</span>
                <span className="text-[color:var(--mute-2)]">hover to inspect</span>
              </div>
              <pre className="font-mono text-[11.5px] leading-[1.75] text-[color:var(--paper-dim)]">
                {codeLines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[22px_1fr] gap-3">
                    <span className="text-right text-[color:var(--mute-2)]">{i + 1}</span>
                    <span>{line || " "}</span>
                  </div>
                ))}
              </pre>
            </div>
          </Lens>

          <div className="panel-inset p-4">
            <div
              className="flex items-center gap-3 border-b pb-2.5 text-[12px]"
              style={{ borderColor: "var(--line)" }}
            >
              <Terminal className="h-3.5 w-3.5 text-[color:var(--mute)]" />
              <span className="font-mono text-[color:var(--mute)]">{c.terminal.cmd}</span>
            </div>
            <div className="font-mono mt-3 space-y-1 text-[11.5px] leading-5">
              <p>
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: "var(--amber)", color: "#160c00" }}
                >
                  {c.terminal.pass}
                </span>{" "}
                <span className="text-[color:var(--paper-dim)]">{c.terminal.file}</span>
              </p>
              {c.tests.map((t) => (
                <p key={t} className="text-[color:var(--mute)]">
                  ✓ {t}
                </p>
              ))}
              <p className="pt-1.5 font-semibold text-[color:var(--paper)]">{c.testSummary}</p>
            </div>
          </div>
        </div>

        {/* review */}
        <div className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <span className="chip">
              <span className="dot dot-amber" />
              {tab === "review" ? r.title : "ready"}
            </span>
          </div>
          <div className="border-b pb-4 text-[13px]" style={{ borderColor: "var(--line)" }}>
            <div className="font-semibold text-[color:var(--paper)]">{r.action}</div>
            <div className="font-mono mt-1 text-[11px] text-[color:var(--mute)]">{c.file}</div>
          </div>

          <ReviewBlock label={r.summaryLabel}>
            <span>{r.summary}</span>
          </ReviewBlock>
          <ReviewBlock label={r.impactLabel}>
            <ul className="space-y-1">
              {r.impact.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          </ReviewBlock>

          <div className="mt-6 space-y-2.5">
            <button
              className="h-11 w-full rounded-md text-[13px] font-semibold transition-colors"
              style={{ background: "var(--amber)", color: "#160c00" }}
            >
              {r.approve}
            </button>
            <button
              className="h-11 w-full rounded-md border text-[13px] font-semibold transition-colors hover:border-[color:var(--paper)]"
              style={{ borderColor: "var(--line-2)", color: "var(--paper)" }}
            >
              {r.request}
            </button>
            <button className="h-9 w-full text-[12px] text-[color:var(--mute)] transition-colors hover:text-[color:var(--paper)]">
              {r.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 text-[12.5px] leading-6">
      <div className="font-mono mb-1.5 text-[11px] uppercase tracking-wider text-[color:var(--mute)]">
        {label}
      </div>
      <div className="text-[color:var(--paper-dim)]">{children}</div>
    </div>
  );
}

"use client";

import { ArrowRightLeft, Braces, FileText, Languages, Mic2 } from "lucide-react";

type BilingualLocale = "zh" | "en";

const copy = {
  zh: {
    header: "同一份工作上下文",
    enTitle: "Create a user endpoint.",
    enBody: "Add validation and run success / failure tests before applying.",
    zhTitle: "给用户接口加校验。",
    zhBody: "成功和失败场景都跑一遍，应用前先让我确认。",
    core: "同一任务",
    coreMeta: "文件 / 工具 / 审批",
    contextTitle: "整理后的任务",
    tools: ["代码", "语音", "文件"],
    rows: [
      {
        label: "意图",
        value: "用户接口 / user endpoint",
      },
      {
        label: "约束",
        value: "校验、测试、边界条件",
      },
      {
        label: "交付",
        value: "变更前等待确认",
      },
    ],
  },
  en: {
    header: "same working context",
    enTitle: "Create a user endpoint.",
    enBody: "Add validation and run success / failure tests before applying.",
    zhTitle: "给用户接口加校验。",
    zhBody: "成功和失败场景都跑一遍，应用前先让我确认。",
    core: "same task",
    coreMeta: "files / tools / approval",
    contextTitle: "Aligned task",
    tools: ["code", "voice", "files"],
    rows: [
      {
        label: "Intent",
        value: "user endpoint",
      },
      {
        label: "Rules",
        value: "validation, tests, edge cases",
      },
      {
        label: "Output",
        value: "approval before apply",
      },
    ],
  },
} satisfies Record<
  BilingualLocale,
  {
    header: string;
    enTitle: string;
    enBody: string;
    zhTitle: string;
    zhBody: string;
    core: string;
    coreMeta: string;
    contextTitle: string;
    tools: string[];
    rows: Array<{ label: string; value: string }>;
  }
>;

export function BilingualBeams({
  enLabel,
  zhLabel,
  coreLabel,
  locale,
}: {
  enLabel: string;
  zhLabel: string;
  coreLabel: string;
  locale: BilingualLocale;
}) {
  const c = copy[locale];

  return (
    <div className="bilingual-composer" aria-hidden="true">
      <div className="bc-grid" />
      <div className="bc-aura" />

      <div className="bc-header">
        <div>
          <Languages className="h-4 w-4" />
          <span>{coreLabel}</span>
        </div>
        <strong>{c.header}</strong>
      </div>

      <div className="bc-stage">
        <div className="bc-speech bc-speech-en">
          <small>{enLabel}</small>
          <strong>{c.enTitle}</strong>
          <p>{c.enBody}</p>
        </div>

        <div className="bc-context-core">
          <div className="bc-core-mark">
            <Languages className="h-5 w-5" />
            <strong>DJL</strong>
          </div>
          <span>{c.core}</span>
          <small>{c.coreMeta}</small>
        </div>

        <div className="bc-speech bc-speech-zh">
          <small>{zhLabel}</small>
          <strong>{c.zhTitle}</strong>
          <p>{c.zhBody}</p>
        </div>
      </div>

      <div className="bc-context-card">
        <div className="bc-context-head">
          <span>{c.contextTitle}</span>
          <ArrowRightLeft className="h-4 w-4" />
        </div>
        {c.rows.map((row) => (
          <div key={row.label} className="bc-context-row">
            <small>{row.label}</small>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>

      <div className="bc-tools">
        <span>
          <Braces className="h-4 w-4" />
          {c.tools[0]}
        </span>
        <span>
          <Mic2 className="h-4 w-4" />
          {c.tools[1]}
        </span>
        <span>
          <FileText className="h-4 w-4" />
          {c.tools[2]}
        </span>
      </div>
    </div>
  );
}

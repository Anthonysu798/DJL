import type { WorkTurnPolicy } from "@synara/contracts";

const WEB_FRESHNESS =
  /\b(prices?|stocks?|markets?|weather|news|exchange rates?|scores?|schedules?|web\s*search|web\s*fetch)\b|\b(?:analy[sz]e|research|evaluate)\b.{0,80}\b(?:compan(?:y|ies)|business|investment)\b|(?:分析|研究|评估).{0,40}(?:公司|企业|投资)|股价|股票|行情|天气|新闻|汇率|比分|赛程/i;
const SYSTEM_INFO =
  /\b(this (?:computer|mac|pc)|my (?:computer|mac|pc)|ram|system memory|cpu|disk space)\b|这台电脑|我的电脑|本机|内存(?:有|是|多少)|处理器|磁盘空间/i;
const OFFICE =
  /\b(create|make|draft|generate|edit|modify|merge|split|compare|redact|export)\b.{0,40}\b(docx|word|document|pdfs?|spreadsheet|xlsx|excel|presentation|pptx|slides?)\b|(?:创建|修改|合并|拆分|比较|涂黑|删节|导出).{0,20}(?:文档|Word|PDF|表格|演示文稿)/i;
const OFFICE_DOCUMENT_READ =
  /\b(read|open|inspect|review)\b.{0,80}(?:^|\s)[\w.@%+~/-]+\.(?:docx|xlsx|pptx|pdf)\b|(?:读取|打开|检查|查看).{0,40}[\w.@%+~/-]+\.(?:docx|xlsx|pptx|pdf)\b/i;
const CODING =
  /\b(code|coding|bug|typescript|javascript|python|compile|unit test|run (?:the )?test|patch)\b|代码|编程|修复.{0,12}(?:错误|问题)|运行.{0,8}测试/i;
const EXPLICIT_FILE =
  /(?:^|\s)(?:\/[\w.@%+~/-]+|[A-Za-z]:\\[^\s]+)|\b(read|list|search|write|edit)\b.{0,30}\b(file|folder|directory)\b|读取.{0,20}(?:文件|目录)|列出.{0,12}(?:文件|目录)/i;

const officeTools = (prompt: string): ReadonlyArray<string> => {
  if (/\bmerge\b.{0,30}\bpdfs?\b|合并.{0,12}PDF/i.test(prompt)) {
    return ["djl_merge_pdfs"];
  }
  if (/\bsplit\b.{0,30}\bpdfs?\b|拆分.{0,12}PDF/i.test(prompt)) {
    return ["djl_split_pdf"];
  }
  if (/\bcompare\b.{0,30}\bpdfs?\b|比较.{0,12}PDF/i.test(prompt)) {
    return ["djl_compare_pdfs"];
  }
  if (/\bredact\b.{0,30}\bpdfs?\b|涂黑.{0,12}PDF|删节.{0,12}PDF/i.test(prompt)) {
    return ["djl_redact_pdf"];
  }
  if (/\bexport\b.{0,30}\b(?:text|markdown)\b.{0,30}\bpdf\b|导出.{0,20}PDF/i.test(prompt)) {
    return ["djl_export_text_pdf"];
  }
  if (/\b(edit|modify|replace|update)\b|修改|替换|更新/i.test(prompt)) {
    return ["djl_modify_office_copy"];
  }
  return ["djl_create_document"];
};

const policy = (
  route: WorkTurnPolicy["route"],
  visibleTools: ReadonlyArray<string>,
  requireSuccessfulTool: boolean,
  evidenceRequired: boolean,
): WorkTurnPolicy => ({
  route,
  visibleTools,
  requireSuccessfulTool,
  evidenceRequired,
  instructionScope: "work-isolated",
});

export function decideWorkTurnPolicy(input: {
  readonly prompt: string;
  readonly hasAttachments?: boolean;
}): WorkTurnPolicy {
  const prompt = input.prompt.trim();
  if (SYSTEM_INFO.test(prompt)) {
    return policy("system-info", ["djl_system_info"], true, true);
  }
  if (WEB_FRESHNESS.test(prompt)) {
    return policy("web-research", ["websearch", "webfetch"], true, true);
  }
  if (OFFICE_DOCUMENT_READ.test(prompt)) {
    return policy("file", ["djl_read_document"], true, true);
  }
  if (OFFICE.test(prompt)) {
    return policy("office", officeTools(prompt), true, true);
  }
  if (CODING.test(prompt)) {
    return policy(
      "coding",
      ["read", "glob", "grep", "edit", "write", "apply_patch", "bash"],
      true,
      true,
    );
  }
  if (input.hasAttachments || EXPLICIT_FILE.test(prompt)) {
    const requestsWrite =
      /\b(write|edit|modify|create|delete|move|rename)\b|写入|编辑|修改|创建|删除|移动|重命名/i.test(
        prompt,
      );
    return policy(
      "file",
      [
        "read",
        "glob",
        "grep",
        "djl_list_files",
        "djl_read_document",
        ...(requestsWrite ? ["write", "edit", "apply_patch"] : []),
      ],
      true,
      true,
    );
  }
  return policy("chat", [], false, false);
}

export function buildGroundedWorkPrompt(userPrompt: string, turnPolicy: WorkTurnPolicy): string {
  if (turnPolicy.route === "chat") {
    return userPrompt;
  }
  const behavior = [
    "Do not write an answer before a visible tool succeeds.",
    "Use only successful tool output as evidence. Memory and prior prose are not evidence.",
    "If the tool is unavailable, denied, empty, or conflicting, say that directly and do not guess.",
    ...(turnPolicy.route === "system-info"
      ? [
          "Call djl_system_info now before answering.",
          "For RAM and disk sizes, copy the tool's canonical GiB fields exactly. Do not convert or recalculate raw byte values.",
        ]
      : []),
    ...(turnPolicy.route === "web-research"
      ? [
          "Include the source URLs and retrieval time in the answer.",
          "Every current number, date, price, currency, and percentage must match collected evidence.",
          "Copy labeled market facts exactly: never relabel Open, Bid, Ask, or another value as Previous Close.",
          "If the evidence says At close or names an earlier trading date, call it the latest available close with that exact date; never call it today's live price.",
          "If sources disagree about the current value or what a number means, report the conflict instead of choosing silently.",
          "Do not calculate or restate a change unless the successful tool output explicitly pairs that change with the same price.",
        ]
      : []),
    ...(turnPolicy.route === "file"
      ? [
          `For an explicit file path, call ${turnPolicy.visibleTools[0]} now with that exact path before answering. Do not answer from conversation history.`,
        ]
      : []),
    ...(turnPolicy.route === "office"
      ? [
          `Call ${turnPolicy.visibleTools[0]} now and do not claim that a deliverable exists until that exact tool succeeds.`,
        ]
      : []),
    ...(turnPolicy.route === "coding"
      ? [
          "Inspect the requested files with read or search first, then use only the scoped coding tools needed for the requested change.",
        ]
      : []),
  ];
  return [
    "<djl_work_policy>",
    ...behavior,
    "</djl_work_policy>",
    "<user_request_json>",
    JSON.stringify(userPrompt),
    "</user_request_json>",
  ].join("\n");
}

import { describe, expect, it } from "vitest";
import englishCatalog from "./locales/en.json";
import simplifiedChineseCatalog from "./locales/zh-Hans.json";
import traditionalChineseCatalog from "./locales/zh-Hant.json";
import japaneseCatalog from "./locales/ja.json";
import koreanCatalog from "./locales/ko.json";
import latinAmericanSpanishCatalog from "./locales/es-419.json";
import frenchCatalog from "./locales/fr.json";

const SECONDARY_CATALOGS = {
  "zh-Hans": simplifiedChineseCatalog,
  "zh-Hant": traditionalChineseCatalog,
  ja: japaneseCatalog,
  ko: koreanCatalog,
  "es-419": latinAmericanSpanishCatalog,
  fr: frenchCatalog,
} as const;

// Whole-value product names and technical tokens only. Ordinary UI copy must be translated.
const ENGLISH_EQUAL_INVARIANTS = new Map<string, string>([
  ["chat.panels.names.git", "Git"],
  ["chat.panels.names.side", "Side"],
  ["settings.navigation.groups.djl", "DJL"],
]);

function collectLeaves(value: unknown, path: readonly string[] = []): Map<string, unknown> {
  if (value !== null && typeof value === "object") {
    return new Map(
      Object.entries(value).flatMap(([key, nested]) => [...collectLeaves(nested, [...path, key])]),
    );
  }

  return new Map([[path.join("."), value]]);
}

function collectPlaceholders(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/{{[^{}]+}}/g)].map(([placeholder]) => placeholder).toSorted();
}

const TAIWAN_SETTINGS_ROUTE_FORBIDDEN_SIMPLIFIED_TERMS = [
  "主题",
  "组织",
  "最新优先",
  "独立",
  "技术",
  "导向",
  "标签页",
  "视图",
  "回顾",
  "置顶",
  "高亮",
  "带下划线",
  "会话",
  "进行",
  "标记",
  "输出",
  "状态",
  "影响",
  "询问",
  "历史",
  "用于",
  "标题",
  "名称",
  "写作",
  "自定义",
  "添加",
  "输入",
  "该",
  "支持",
  "并",
  "这里",
  "检测",
  "排队",
  "失败",
  "旧版本",
  "覆盖",
  "二进制",
  "相应",
  "文档",
  "界面",
  "识别",
  "一键",
  "可选",
  "端点",
  "传递",
  "启动",
  "实验性",
  "关于",
  "编辑",
  "当",
  "由于",
  "修复",
  "时间",
  "内容",
  "复制",
  "验证",
] as const;

describe("secondary locale catalog translations", () => {
  it("uses Taiwan Traditional Chinese throughout the settings route catalog", () => {
    const routeCopy = [...collectLeaves(traditionalChineseCatalog.settings.route).values()]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    const findings = TAIWAN_SETTINGS_ROUTE_FORBIDDEN_SIMPLIFIED_TERMS.filter((term) =>
      routeCopy.includes(term),
    );

    expect(findings).toEqual([]);
  });

  it.each(Object.entries(SECONDARY_CATALOGS))(
    "%s leaves only genuine invariants equal to English",
    (_locale, catalog) => {
      const englishLeaves = collectLeaves(englishCatalog);
      const secondaryLeaves = collectLeaves(catalog);
      const equalPaths = [...englishLeaves]
        .filter(([path, englishValue]) => secondaryLeaves.get(path) === englishValue)
        .map(([path]) => path)
        .toSorted();

      expect(equalPaths).toEqual([...ENGLISH_EQUAL_INVARIANTS.keys()].toSorted());
      for (const [path, expectedValue] of ENGLISH_EQUAL_INVARIANTS) {
        expect(englishLeaves.get(path)).toBe(expectedValue);
        expect(secondaryLeaves.get(path)).toBe(expectedValue);
      }
    },
  );

  it.each(Object.entries(SECONDARY_CATALOGS))(
    "%s preserves every interpolation placeholder",
    (_locale, catalog) => {
      const englishLeaves = collectLeaves(englishCatalog);
      const secondaryLeaves = collectLeaves(catalog);

      for (const [path, englishValue] of englishLeaves) {
        expect(collectPlaceholders(secondaryLeaves.get(path)), path).toEqual(
          collectPlaceholders(englishValue),
        );
      }
    },
  );
});

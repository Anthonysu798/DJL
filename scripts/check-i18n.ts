import { checkRepositoryI18n } from "./i18n/check.ts";

const result = checkRepositoryI18n();
if (result.errors.length > 0) {
  console.error(result.errors.join("\n"));
  console.error(
    `i18n:check failed: ${result.visibleEnglishFindings} visible-English finding(s), ${result.catalogLeaves} web catalog leaves.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `i18n:check passed: 7 locales, ${result.catalogLeaves} leaves each, ${result.visibleEnglishFindings} residual visible-English findings.`,
  );
}

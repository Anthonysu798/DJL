import type { MultiPostNotice } from "@djl/contracts";

type Words = Record<MultiPostNotice["kind"], [title: string, hint: string]>;
const words: Record<string, Words> = {
  en: {
    posted: ["Your post is live", ""],
    failed: ["A post didn't go out", "Open DJL to try again."],
    "needs-you": ["A post needs you", "Open DJL to finish it."],
  },
  "zh-Hans": {
    posted: ["帖子已发布", ""],
    failed: ["有一条帖子没发出去", "打开 DJL 再试一次。"],
    "needs-you": ["有一条帖子需要你处理", "打开 DJL 完成它。"],
  },
  "zh-Hant": {
    posted: ["貼文已發布", ""],
    failed: ["有一則貼文沒發出去", "打開 DJL 再試一次。"],
    "needs-you": ["有一則貼文需要你處理", "打開 DJL 完成它。"],
  },
  ja: {
    posted: ["投稿されました", ""],
    failed: ["投稿できませんでした", "DJL を開いてもう一度お試しください。"],
    "needs-you": ["投稿の確認が必要です", "DJL を開いて完了してください。"],
  },
  ko: {
    posted: ["게시물이 올라갔습니다", ""],
    failed: ["게시물을 올리지 못했습니다", "DJL을 열어 다시 시도하세요."],
    "needs-you": ["게시물을 확인해 주세요", "DJL을 열어 마무리하세요."],
  },
  es: {
    posted: ["Tu publicación ya está en línea", ""],
    failed: ["Una publicación no salió", "Abre DJL para intentarlo de nuevo."],
    "needs-you": ["Una publicación necesita tu atención", "Abre DJL para terminarla."],
  },
  fr: {
    posted: ["Votre publication est en ligne", ""],
    failed: ["Une publication n'est pas partie", "Ouvrez DJL pour réessayer."],
    "needs-you": ["Une publication a besoin de vous", "Ouvrez DJL pour la terminer."],
  },
};
function language(locale: string) {
  const [base = "en", region = ""] = locale.split("-");
  if (base === "zh") return /^(TW|HK|MO|Hant)$/i.test(region) ? "zh-Hant" : "zh-Hans";
  return base in words ? base : "en";
}
/** The few words a system notification shows when a post finishes while the person is elsewhere. */
export function noticeText(notice: MultiPostNotice, locale: string) {
  const [title, hint] = words[language(locale)]![notice.kind];
  return {
    title,
    body: [notice.label && (hint ? `${notice.label}.` : notice.label), hint]
      .filter(Boolean)
      .join(" "),
  };
}

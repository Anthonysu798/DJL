import { Site } from "./Site";
import type { ConsoleTab, Locale } from "./content";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  // Chinese is the default; opt into English with ?lang=en
  const locale: Locale = params.lang === "en" ? "en" : "zh";
  const tabParam = params.tab;
  const tab: ConsoleTab = tabParam === "tools" || tabParam === "review" ? tabParam : "plan";

  return <Site locale={locale} tab={tab} />;
}

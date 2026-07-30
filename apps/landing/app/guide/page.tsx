import type { Metadata } from "next";
import type { Locale } from "../content";
import { GuideDoc } from "./GuideDoc";

export const metadata: Metadata = {
  title: "DJL guide - run the agent and install a local model",
  description:
    "How a DJL task runs from plan to approved diff, and how to install a local model on your own hardware with Ollama or LM Studio. Includes which curated models can drive the agent and which are chat only.",
};

export default async function GuidePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  // Chinese is the default here too, matching the home page rather than inventing
  // an English-first default for a second surface.
  const locale: Locale = params.lang === "en" ? "en" : "zh";

  return <GuideDoc locale={locale} />;
}

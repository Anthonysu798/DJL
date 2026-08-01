import type { Metadata, Viewport } from "next";
import { DocsShell } from "../../docs/DocsShell";

export const metadata: Metadata = {
  title: "DJL docs - run the agent and install a local model",
  description:
    "How a DJL task runs from plan to approved diff, and how to install a local model on your own hardware with Ollama or LM Studio. Includes which curated models can drive the agent and which are chat only.",
  alternates: {
    languages: { "zh-CN": "/docs", en: "/en/docs" },
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function EnglishDocsPage() {
  return <DocsShell locale="en" />;
}

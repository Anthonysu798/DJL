// FILE: _chat.work.ai-writing-check.tsx
// Purpose: Standalone DJL Work route for the local AI Writing Check.

import { createFileRoute } from "@tanstack/react-router";

import { AiWritingCheckView } from "../components/work/AiWritingCheckView";

export const Route = createFileRoute("/_chat/work/ai-writing-check")({
  component: AiWritingCheckView,
});

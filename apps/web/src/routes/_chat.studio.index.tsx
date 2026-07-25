// FILE: _chat.studio.index.tsx
// Purpose: Keeps the legacy Studio URL compatible while moving users to DJL Work.
// Layer: Routing

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/studio/")({
  beforeLoad: () => {
    throw redirect({ to: "/work", replace: true });
  },
});

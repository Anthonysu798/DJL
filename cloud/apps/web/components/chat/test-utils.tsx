import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { createChatClient } from "@/lib/chat/client";
import { ChatProvider } from "@/lib/chat/context";
import { createMockApi, type MockScenario } from "@/lib/chat/mock/server";
import { LocaleProvider } from "@/lib/locale-context";

import { Toaster } from "./toast";

/** Renders UI inside the providers the chat area needs, backed by the mock API. */
export function renderWithChat(ui: ReactNode, scenario: MockScenario = "default") {
  const mock = createMockApi({ baseUrl: "https://api.test", tickMs: 1, scenario });
  const client = createChatClient({ baseUrl: "https://api.test", fetch: mock.fetch });
  const utils = render(
    <LocaleProvider locale="en">
      <ChatProvider client={client}>
        <TooltipProvider>
          {ui}
          <Toaster />
        </TooltipProvider>
      </ChatProvider>
    </LocaleProvider>,
  );
  return { ...utils, mock, client };
}

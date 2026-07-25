import { describe, expect, it } from "vitest";

import type { ComposerCommandItem } from "~/components/chat/ComposerCommandMenu";
import { filterKanbanComposerMenuItems } from "./useKanbanTaskComposerDiscovery";

describe("filterKanbanComposerMenuItems", () => {
  it("removes model/provider selection commands while retaining supported task commands", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "model:opencode:openai/gpt-5.4",
        type: "model",
        provider: "opencode",
        model: "openai/gpt-5.4",
        label: "GPT-5.4",
        description: "OpenCode",
      },
      {
        id: "slash:plan",
        type: "slash-command",
        command: "plan",
        label: "/plan",
        description: "Plan",
        source: "app",
      },
      {
        id: "slash:review",
        type: "slash-command",
        command: "review",
        label: "/review",
        description: "Review",
        source: "app",
      },
    ];

    expect(filterKanbanComposerMenuItems(items)).toEqual([items[1]]);
  });
});

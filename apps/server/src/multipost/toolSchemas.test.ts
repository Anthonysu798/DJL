import { it, expect } from "vitest";
import { MULTIPOST_TOOLS } from "./mcp";
it("describes a complete typed draft so agents can call it without reading app code", () => {
  const tool = MULTIPOST_TOOLS.find((x) => x.name === "djl_multipost_draft")!;
  expect((tool.inputSchema.properties as Record<string, unknown>).draft).toMatchObject({
    type: "object",
    required: ["kind", "data", "targets", "publicationMode", "scheduledAt", "timezone"],
    properties: {
      kind: { enum: ["dynamic", "article", "video", "podcast"] },
      data: { required: ["title"] },
      targets: { type: "array", items: { required: ["accountId", "adapterId"] } },
    },
  });
});

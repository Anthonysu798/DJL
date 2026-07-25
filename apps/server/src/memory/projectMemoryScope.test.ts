import { ProjectId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveProjectMemoryScope } from "./projectMemoryScope.ts";

describe("resolveProjectMemoryScope", () => {
  it("keeps managed Work memory in its container scope", () => {
    expect(
      resolveProjectMemoryScope({
        containerProjectId: ProjectId.makeUnsafe("studio-project"),
        containerTitle: "DJL Work",
        workspaceRoot: null,
      }),
    ).toEqual({
      projectId: "studio-project",
      title: "DJL Work",
      kind: "managed",
    });
  });

  it("isolates folders while keeping the same folder stable across tasks", () => {
    const base = {
      containerProjectId: ProjectId.makeUnsafe("studio-project"),
      containerTitle: "DJL Work",
    };
    const first = resolveProjectMemoryScope({ ...base, workspaceRoot: "/Clients/Acme" });
    const same = resolveProjectMemoryScope({ ...base, workspaceRoot: "/Clients/Acme/" });
    const second = resolveProjectMemoryScope({ ...base, workspaceRoot: "/Clients/Beacon" });

    expect(first).toEqual(same);
    expect(first.projectId).not.toBe(second.projectId);
    expect(first.title).toBe("Acme");
    expect(first.kind).toBe("workspace");
  });
});

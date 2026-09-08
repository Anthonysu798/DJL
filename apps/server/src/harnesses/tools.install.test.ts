import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { DEFAULT_SERVER_SETTINGS, type HarnessToolId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";
import { createHarnessToolsController, inspectHarnessTool, maintainHarnessTool } from "./tools";
import { inspectInstalledOpenCodeProtocol } from "../provider/openCodeInstalledProtocol";

// This fixture exercises package-manager subprocesses; real protocol coverage lives separately.
vi.mock("../provider/openCodeInstalledProtocol", () => ({
  inspectInstalledOpenCodeProtocol: vi.fn(async () => ({ compatible: true })),
}));

// Real subprocess/install/detection round trip against an isolated package-manager fixture.
describe.skipIf(process.platform === "win32")("provider installation round trip", () => {
  it("installs all three official package IDs and verifies the external OpenCode protocol", async () => {
    const dir = await mkdtemp(join(tmpdir(), "djl-cli-install-"));
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "npm"),
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo 11.0.0; exit 0; fi
case "$3" in
  '@openai/codex@latest') name=codex ;;
  '@anthropic-ai/claude-code@latest') name=claude ;;
  'opencode-ai@latest') name=opencode ;;
  *) exit 2 ;;
esac
/bin/echo '#!/bin/sh' > "${bin}/$name"
/bin/echo 'echo 2.0.0' >> "${bin}/$name"
/bin/chmod +x "${bin}/$name"
`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", bin);
    vi.stubEnv("DJL_OPENCODE_BINARY_PATH", join(dir, "bundled-must-not-change"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: "2.0.0" }))),
    );
    const settings = { ...DEFAULT_SERVER_SETTINGS, enableProviderUpdateChecks: true };
    const inspect = (id: HarnessToolId) =>
      Effect.runPromise(inspectHarnessTool(id, settings).pipe(Effect.provide(NodeServices.layer)));
    const controller = createHarnessToolsController({
      inspect,
      run: (before) =>
        Effect.runPromise(
          maintainHarnessTool(before, settings).pipe(Effect.provide(NodeServices.layer)),
        ),
    });
    try {
      for (const harness of ["codex", "claudeAgent", "opencode"] as const) {
        expect(await inspect(harness)).toMatchObject({
          installed: false,
          canInstall: true,
          latestVersion: "2.0.0",
        });
        expect(await controller.maintain({ harness })).toMatchObject({
          installed: true,
          currentVersion: "2.0.0",
          status: "current",
        });
      }
      expect(inspectInstalledOpenCodeProtocol).toHaveBeenCalledWith("opencode", "2.0.0");
      expect(await inspect("opencode")).toMatchObject({ installed: true, compatible: true });
      expect(inspectInstalledOpenCodeProtocol).not.toHaveBeenCalledWith(
        join(dir, "bundled-must-not-change"),
        expect.anything(),
      );
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

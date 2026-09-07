import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { prepareProfileShell } from "./profileShell";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture(shell: string) {
  const root = await mkdtemp(join(tmpdir(), "djl-profile-shell-"));
  roots.push(root);
  const executable = join(root, "fake agent");
  await writeFile(
    executable,
    '#!/bin/sh\nprintf "AGENT_HOME=%s KEY=%s\\n" "$CODEX_HOME" "${OPENAI_API_KEY:-unset}"\nread answer || { echo INPUT_UNAVAILABLE; exit 1; }\nprintf "AGENT_EXIT\\n"\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(root, shell === "/bin/zsh" ? ".zshrc" : ".bashrc"),
    'export OPENAI_API_KEY="must-be-removed"\nexport CODEX_HOME="wrong-account"\ncd /\n' +
      (shell === "/bin/zsh"
        ? "exec {djl_test_stdin}<&0\nexec </dev/null\n_djl_restore_input() { exec 0<&$djl_test_stdin; }\nprecmd_functions=(_djl_restore_input)\n"
        : ""),
  );
  const launch = await prepareProfileShell({
    directory: root,
    cwd: root,
    provider: "codex",
    executable,
    prefixArgs: [],
    initialArgs: [],
    env: { CODEX_HOME: join(root, "account") },
    removeEnv: ["OPENAI_API_KEY"],
    baseEnv: { HOME: root, SHELL: shell, PATH: "/usr/bin:/bin" },
  });
  return { root, launch };
}
describe.skipIf(process.platform === "win32")("persistent profile shell", () => {
  it.each(process.platform === "darwin" ? ["/bin/zsh", "/bin/bash"] : ["/bin/bash"])(
    "returns from the agent to the same %s shell and can run it again",
    async (shell) => {
      const { root, launch } = await fixture(shell);
      const child = spawn(launch.command.executable, launch.command.args, {
        cwd: root,
        env: { HOME: root, PATH: "/usr/bin:/bin", TERM: "xterm", ...launch.env },
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
      // Native /exit returns from the CLI. Subsequent commands go to the existing shell.
      child.stdin.end('/exit\nprintf "SHELL_CWD=%s\\n" "$PWD"\ncodex\n/exit\nexit\n');
      expect(await closed).toBe(0);
      expect(await realpath(output.match(/SHELL_CWD=([^\r\n]+)/)![1]!)).toBe(await realpath(root));
      expect(output.match(/AGENT_EXIT/g)).toHaveLength(2);
      expect(output.match(/KEY=unset/g)).toHaveLength(2);
      expect(output).not.toContain("AGENT_HOME=wrong-account");
      expect(output).not.toContain("INPUT_UNAVAILABLE");
    },
  );
});

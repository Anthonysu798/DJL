import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareProfileShell } from "./profileShell";

it.skipIf(process.platform !== "darwin")(
  "starts an agent after ZLE is restored by an instant-prompt theme",
  async () => {
    const { spawn } = await import("node-pty");
    const root = await mkdtemp(join(tmpdir(), "djl-profile-pty-"));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await writeFile(
        join(root, ".zshrc"),
        `
unsetopt zle
_restore_zle() { setopt zle; }
precmd_functions=(_restore_zle)
zle-line-init() { export DJL_PROMPT_READY=1; }
zle -N zle-line-init
PS1='READY> '
`,
      );
      const executable = join(root, "fake-agent");
      await writeFile(
        executable,
        '#!/bin/sh\nprintf "AGENT_PROMPT_READY=%s\\n" "${DJL_PROMPT_READY:-0}"\n',
        { mode: 0o755 },
      );
      const baseEnv = {
        HOME: root,
        SHELL: "/bin/zsh",
        PATH: "/usr/bin:/bin",
        TERM: "xterm-256color",
      };
      const launch = await prepareProfileShell({
        directory: join(root, "launch"),
        cwd: root,
        provider: "codex",
        executable,
        prefixArgs: [],
        initialArgs: [],
        env: {},
        removeEnv: [],
        baseEnv,
      });
      child = spawn(launch.command.executable, launch.command.args, {
        cwd: root,
        cols: 80,
        rows: 24,
        env: { ...baseEnv, ...launch.env },
      });
      let output = "";
      child.onData((data) => {
        output += data;
      });
      await expect.poll(() => output, { timeout: 5000 }).toContain("AGENT_PROMPT_READY=1");
      expect(output).not.toContain("AGENT_PROMPT_READY=0");
    } finally {
      child?.kill();
      await rm(root, { recursive: true, force: true });
    }
  },
);

import { mkdir, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import type { TerminalCommand } from "../terminal/Services/Manager";
import type { HarnessId } from "@synara/contracts";

const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const COMMANDS = {
  codex: "codex",
  claudeAgent: "claude",
  cursor: "cursor-agent",
  opencode: "opencode",
  kimi: "kimi",
  grok: "grok",
  iflow: "iflow",
  qwen: "qwen",
  codebuddy: "codebuddy",
  pi: "pi",
} as const;

export async function prepareProfileShell(input: {
  directory: string;
  cwd: string;
  provider: HarnessId;
  executable: string;
  prefixArgs: string[];
  initialArgs: string[];
  env: Record<string, string>;
  removeEnv: string[];
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<{ env: Record<string, string>; command: TerminalCommand }> {
  const base = input.baseEnv ?? process.env;
  const platform = input.platform ?? process.platform;
  const commandName = COMMANDS[input.provider];
  const shellDir = join(input.directory, "shell");
  const binDir = join(shellDir, "bin");
  await mkdir(binDir, { recursive: true, mode: 0o700 });
  const env = { ...input.env };
  const setEnv = Object.entries(env)
    .map(([key, value]) => `export ${key}=${quote(value)}`)
    .join("\n");
  const unsetEnv = input.removeEnv.length ? `unset ${input.removeEnv.map(quote).join(" ")}` : "";
  const args = input.prefixArgs.map(quote).join(" ");
  const executableDir =
    input.executable.includes("/") || input.executable.includes("\\")
      ? dirname(input.executable)
      : "";
  const pathPrefix = [binDir, executableDir].filter(Boolean).join(delimiter);
  const managerHint =
    input.provider === "codex" && /[\\/]\.bun[\\/]bin[\\/]/.test(input.executable)
      ? "export npm_config_user_agent='bun/'\n"
      : "";
  const cleanPath = `
_djl_path=""
_djl_ifs="$IFS"
IFS=:
set -f
for _djl_dir in $PATH; do
  case "$_djl_dir" in */_managed-bin|*/terminal-accounts/*|${quote(binDir)}) continue ;; esac
  _djl_path="\${_djl_path:+$_djl_path:}$_djl_dir"
done
IFS="$_djl_ifs"
export PATH="$_djl_path"
`;
  // The wrapper pins credentials, not the package contents: in-place CLI updates are picked up immediately.
  await writeFile(
    join(binDir, commandName),
    `#!/bin/sh\n${cleanPath}\n${unsetEnv}\n${setEnv}\n${managerHint}exec ${quote(input.executable)} ${args} "$@"\n`,
    { mode: 0o700 },
  );
  const initial = `${commandName} ${input.initialArgs.map(quote).join(" ")}`;
  // Prompt frameworks can still capture standard streams inside precmd. Agent TUIs
  // must talk directly to this shell's controlling terminal, not those captures.
  const runInitial = `if (: </dev/tty) 2>/dev/null; then
  ${initial} </dev/tty >/dev/tty 2>&1 || true
else
  ${initial} || true
fi`;
  const setup = `cd -- ${quote(input.cwd)}\n${unsetEnv}\n${setEnv}\nexport PATH=${quote(pathPrefix)}:"$PATH"\nunalias ${commandName} 2>/dev/null || true\n${commandName}() { ${quote(join(binDir, commandName))} "$@"; }\n`;
  if (platform === "win32") {
    const psEnv = Object.entries(env)
      .map(([k, v]) => `$env:${k} = ${psQuote(v)}`)
      .join("\n");
    const cleanup = input.removeEnv
      .map((k) => `Remove-Item ${psQuote(`Env:${k}`)} -ErrorAction SilentlyContinue`)
      .join("\n");
    const psFunction = `function global:${commandName} {\n${cleanup}\n${psEnv}\n& (Get-Command ${psQuote(input.executable)} -CommandType Application -ErrorAction Stop).Source ${input.prefixArgs.map(psQuote).join(" ")} @args\n}`;
    const script = join(shellDir, "profile.ps1");
    await writeFile(
      script,
      `${psFunction}\nSet-Location -LiteralPath ${psQuote(input.cwd)}\nif (-not $env:DJL_AGENT_SKIP_START) { ${commandName} ${input.initialArgs.map(psQuote).join(" ")} }\nRemove-Item Env:DJL_AGENT_SKIP_START -ErrorAction SilentlyContinue\n`,
    );
    return {
      env,
      command: {
        executable: "powershell.exe",
        args: ["-NoLogo", "-NoExit", "-File", script],
        removeEnv: input.removeEnv,
        persistentShell: true,
      },
    };
  }
  const preferred = base.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  if (basename(preferred) === "zsh") {
    const original = base.ZDOTDIR || base.HOME || "";
    const source = (file: string) =>
      `[[ ! -f ${quote(join(original, file))} ]] || source ${quote(join(original, file))}`;
    await writeFile(
      join(shellDir, ".zshenv"),
      `export ZDOTDIR=${quote(original)}\n${source(".zshenv")}\nexport ZDOTDIR=${quote(shellDir)}\n`,
      { mode: 0o600 },
    );
    const startAfterPromptInit = `
if [ -z "\${DJL_AGENT_SKIP_START:-}" ]; then
  _djl_start_agent() {
    precmd_functions=("\${precmd_functions[@]:#_djl_start_agent}")
    unfunction _djl_start_agent
    ${runInitial}
  }
  # Instant-prompt themes can temporarily disable ZLE during .zshrc.
  # A controlling TTY, not the current ZLE option, determines interactive launch.
  if (: </dev/tty) 2>/dev/null; then
    autoload -Uz add-zle-hook-widget
    _djl_start_agent_from_prompt() {
      add-zle-hook-widget -d line-init _djl_start_agent_from_prompt
      zle -U ${quote(initial + "\n")}
    }
    add-zle-hook-widget line-init _djl_start_agent_from_prompt
  else
    typeset -ga precmd_functions
    precmd_functions+=(_djl_start_agent)
  fi
fi
unset DJL_AGENT_SKIP_START
`;
    await writeFile(
      join(shellDir, ".zshrc"),
      `export ZDOTDIR=${quote(original)}\n${source(".zshrc")}\n${setup}\n${startAfterPromptInit}`,
      { mode: 0o600 },
    );
    return {
      env: { ...env, ZDOTDIR: shellDir },
      command: {
        executable: preferred,
        args: ["-i"],
        removeEnv: input.removeEnv,
        persistentShell: true,
      },
    };
  }
  const rc = join(shellDir, "bashrc");
  const originalRc = join(base.HOME || "", ".bashrc");
  await writeFile(
    rc,
    `[ ! -f ${quote(originalRc)} ] || . ${quote(originalRc)}\n${setup}\nif [ -z "\${DJL_AGENT_SKIP_START:-}" ]; then\n${runInitial}\nfi\nunset DJL_AGENT_SKIP_START\n`,
    {
      mode: 0o600,
    },
  );
  return {
    env,
    command: {
      executable: basename(preferred) === "bash" ? preferred : "/bin/bash",
      args: ["--rcfile", rc, "-i"],
      removeEnv: input.removeEnv,
      persistentShell: true,
    },
  };
}

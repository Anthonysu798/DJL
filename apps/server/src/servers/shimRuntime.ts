// FILE: shimRuntime.ts
// Purpose: Writes the `djl-ssh` helper that agents call to run commands on registered servers,
//          mints this process's bearer token for it and exposes both through process.env/PATH.
// Layer: Servers runtime service
import { randomBytes } from "node:crypto";
import nodePath from "node:path";
import { Effect, FileSystem, Layer, Path, ServiceMap } from "effect";

import { ServerConfig } from "../config";

export interface ShimRuntimeShape {
  readonly binDir: string;
  readonly token: string;
  readonly url: string;
}

export class ShimRuntime extends ServiceMap.Service<ShimRuntime, ShimRuntimeShape>()(
  "synara/servers/ShimRuntime",
) {}

export const SHIM_EXEC_ROUTE_PATH = "/api/servers/shim/exec";

const POSIX_SHIM = `#!/bin/sh
# djl-ssh <server name> [--] <command...>   — runs a command on a DJL-registered server.
set -u
if [ "$#" -lt 2 ]; then echo "usage: djl-ssh <server> [--] <command>" >&2; exit 64; fi
server="$1"; shift; [ "\${1:-}" = "--" ] && shift
cmd="$*"
if [ -z "\${DJL_SSH_SHIM_URL:-}" ] || [ -z "\${DJL_SSH_SHIM_TOKEN:-}" ]; then echo "djl-ssh: not running inside DJL" >&2; exit 69; fi
hdr=$(mktemp) || exit 70; out=$(mktemp) || exit 70
trap 'rm -f "$hdr" "$out"' EXIT
printf '%s' "$cmd" | curl -sS --max-time 1800 -X POST "$DJL_SSH_SHIM_URL" \\
  -H "Authorization: Bearer $DJL_SSH_SHIM_TOKEN" -H "X-DJL-Server: $server" \\
  -H "X-DJL-Thread: \${DJL_THREAD_ID:-}" -H "Content-Type: text/plain; charset=utf-8" \\
  --data-binary @- -D "$hdr" -o "$out" || { echo "djl-ssh: could not reach DJL" >&2; exit 70; }
cat "$out"
code=$(tr -d '\\r' < "$hdr" | awk 'tolower($1)=="x-djl-exit-code:" {print $2}' | tail -1)
exit "\${code:-1}"
`;

const WINDOWS_SHIM = [
  "@echo off",
  "setlocal EnableDelayedExpansion",
  "rem djl-ssh <server name> [--] <command...>   - runs a command on a DJL-registered server.",
  'if "%~2"=="" (echo usage: djl-ssh ^<server^> [--] ^<command^> 1>&2 & exit /b 64)',
  'if "%DJL_SSH_SHIM_URL%"=="" (echo djl-ssh: not running inside DJL 1>&2 & exit /b 69)',
  'if "%DJL_SSH_SHIM_TOKEN%"=="" (echo djl-ssh: not running inside DJL 1>&2 & exit /b 69)',
  'set "server=%~1"',
  "shift",
  'if "%~1"=="--" shift',
  'set "cmd="',
  ":collect",
  'if "%~1"=="" goto run',
  'if defined cmd (set "cmd=!cmd! %~1") else (set "cmd=%~1")',
  "shift",
  "goto collect",
  ":run",
  'set "base=%TEMP%\\djl-ssh-%RANDOM%%RANDOM%"',
  '<nul set /p ="!cmd!" > "%base%.body"',
  'curl.exe -sS --max-time 1800 -X POST "%DJL_SSH_SHIM_URL%" ^',
  '  -H "Authorization: Bearer %DJL_SSH_SHIM_TOKEN%" -H "X-DJL-Server: %server%" ^',
  '  -H "X-DJL-Thread: %DJL_THREAD_ID%" -H "Content-Type: text/plain; charset=utf-8" ^',
  '  --data-binary "@%base%.body" -D "%base%.hdr" -o "%base%.out"',
  'if errorlevel 1 (echo djl-ssh: could not reach DJL 1>&2 & del /q "%base%.*" 2>nul & exit /b 70)',
  'type "%base%.out"',
  'set "code=1"',
  'for /f "tokens=2 delims=: " %%c in (\'findstr /i /b /c:"X-DJL-Exit-Code:" "%base%.hdr"\') do set "code=%%c"',
  'del /q "%base%.*" 2>nul',
  "exit /b %code%",
  "",
].join("\r\n");

function envPathKeyFor(env: NodeJS.ProcessEnv): "PATH" | "Path" | "path" {
  if ("PATH" in env) return "PATH";
  if ("Path" in env) return "Path";
  return "path";
}

/** Puts `dir` first in a PATH-style list, removing any other occurrence of it. */
export function prependPathEntry(current: string | undefined, dir: string): string {
  const entries = (current ?? "")
    .split(nodePath.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries[0] === dir) return entries.join(nodePath.delimiter);
  return [dir, ...entries.filter((entry) => entry !== dir)].join(nodePath.delimiter);
}

/** Exposes the shim to every child process DJL spawns from now on. */
export function applyShimEnv(env: NodeJS.ProcessEnv, shim: ShimRuntimeShape): void {
  env.DJL_SSH_SHIM_TOKEN = shim.token;
  env.DJL_SSH_SHIM_BIN = shim.binDir;
  env.DJL_SSH_SHIM_URL = shim.url;
  const pathKey = envPathKeyFor(env);
  env[pathKey] = prependPathEntry(env[pathKey], shim.binDir);
}

export const makeShimRuntime = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const pathApi = yield* Path.Path;
  const config = yield* ServerConfig;

  const binDir = pathApi.join(config.stateDir, "bin");
  const token = randomBytes(32).toString("hex");
  const url = `http://127.0.0.1:${config.port}${SHIM_EXEC_ROUTE_PATH}`;
  const posixPath = pathApi.join(binDir, "djl-ssh");

  yield* fileSystem.makeDirectory(binDir, { recursive: true });
  yield* fileSystem.writeFileString(posixPath, POSIX_SHIM);
  yield* fileSystem.chmod(posixPath, 0o755).pipe(Effect.orElseSucceed(() => undefined));
  yield* fileSystem.writeFileString(pathApi.join(binDir, "djl-ssh.cmd"), WINDOWS_SHIM);

  const shim: ShimRuntimeShape = { binDir, token, url };
  applyShimEnv(process.env, shim);
  return shim;
});

export const ShimRuntimeLive = Layer.effect(ShimRuntime, makeShimRuntime);

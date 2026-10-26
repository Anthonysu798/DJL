import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

// First input line is trusted broker configuration; all subsequent lines are App Server RPC.
let buffer = Buffer.alloc(0);
const configure = (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  const end = buffer.indexOf(10);
  if (end < 0) return;
  process.stdin.pause();
  process.stdin.removeListener("data", configure);
  const config = JSON.parse(buffer.subarray(0, end).toString());
  if (
    !/^[a-zA-Z0-9._:/-]{1,256}$/.test(config.model) ||
    config.gatewayUrl !== "http://codex-broker:8090/v1" ||
    typeof config.token !== "string"
  )
    process.exit(1);
  mkdirSync("/state/codex", { recursive: true, mode: 0o700 });
  mkdirSync("/state/workspace", { recursive: true, mode: 0o700 });
  writeFileSync(
    "/state/codex/config.toml",
    `model = ${JSON.stringify(config.model)}\nmodel_provider = "djl"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\nweb_search = "disabled"\n[model_providers.djl]\nname = "DJL Credits"\nbase_url = ${JSON.stringify(config.gatewayUrl)}\nwire_api = "responses"\nenv_key = "DJL_RUN_TOKEN"\nrequest_max_retries = 0\nstream_max_retries = 0\n`,
    { mode: 0o600 },
  );
  const child = spawn("codex", ["app-server"], {
    cwd: "/workspace",
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/state",
      CODEX_HOME: "/state/codex",
      DJL_RUN_TOKEN: config.token,
    },
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.stdin.write(buffer.subarray(end + 1));
  process.stdin.pipe(child.stdin);
  process.stdin.resume();
  child.on("exit", (code) => process.exit(code ?? 1));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
};
process.stdin.on("data", configure);

// Checks that freshly installed Claude Code and Codex CLIs still start and talk to DJL the way the
// desktop app drives them. Needs no account: Claude is pointed at a local fake model server and
// Codex only completes the app-server handshake. Run: bun scripts/check-agent-cli-compat.ts
//   --claude <path-to-claude> --codex <path-to-codex>
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

import {
  isCodexCliVersionSupported,
  parseCodexCliVersion,
  MINIMUM_CODEX_CLI_VERSION,
} from "../src/provider/codexCliVersion";
import { parseGenericCliVersion } from "../src/provider/providerMaintenance";
import { NativeRpc, object, string } from "../src/harnesses/native/protocol";

const MARKER = "DJL_COMPAT_OK";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`Missing ${name} <path>`);
  return value;
}

function versionOutput(binary: string, env: NodeJS.ProcessEnv): string {
  return execFileSync(binary, ["--version"], {
    env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

// Minimal Anthropic Messages API: every request gets one streamed text reply.
async function startFakeAnthropic() {
  let requests = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method !== "POST" || !request.url?.startsWith("/v1/messages")) {
        response.writeHead(404).end();
        return;
      }
      requests += 1;
      if (request.url.startsWith("/v1/messages/count_tokens")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ input_tokens: 1 }));
        return;
      }
      const model = (JSON.parse(body || "{}") as { model?: string }).model ?? "claude-test";
      const usage = { input_tokens: 1, output_tokens: 1 };
      const message = { id: "msg_djl", type: "message", role: "assistant", model, content: [] };
      const events: Array<[string, unknown]> = [
        ["message_start", { type: "message_start", message: { ...message, usage } }],
        [
          "content_block_start",
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        ],
        [
          "content_block_delta",
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: MARKER } },
        ],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        [
          "message_delta",
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 1 },
          },
        ],
        ["message_stop", { type: "message_stop" }],
      ];
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [event, data] of events)
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake model server has no port");
  return { url: `http://127.0.0.1:${address.port}`, requests: () => requests, server };
}

async function checkClaude(binary: string, root: string) {
  const fake = await startFakeAnthropic();
  const env = {
    ...process.env,
    HOME: join(root, "claude-home"),
    USERPROFILE: join(root, "claude-home"),
    CLAUDE_CONFIG_DIR: join(root, "claude-config"),
    ANTHROPIC_API_KEY: "test-only-not-a-real-key",
    ANTHROPIC_BASE_URL: fake.url,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
  };
  try {
    const version = parseGenericCliVersion(versionOutput(binary, env));
    if (!version) throw new Error("Claude Code --version output is no longer recognized by DJL");
    let reply = "";
    let result: string | undefined;
    // Same SDK entry point and executable option the desktop app uses for the user's install.
    for await (const message of query({
      prompt: "Reply with the marker.",
      options: {
        cwd: root,
        pathToClaudeCodeExecutable: binary,
        env,
        settingSources: [],
        includePartialMessages: true,
        maxTurns: 1,
      },
    })) {
      if (message.type === "assistant")
        for (const block of message.message.content) if (block.type === "text") reply += block.text;
      if (message.type === "result") result = message.subtype;
    }
    if (result !== "success" || !reply.includes(MARKER))
      throw new Error(`Claude Code turn did not complete through DJL's SDK (result: ${result})`);
    console.log(
      `Claude Code ${version}: version parsed, SDK turn completed (${fake.requests()} model requests)`,
    );
  } finally {
    fake.server.close();
  }
}

async function checkCodex(binary: string, root: string) {
  const env = { ...process.env, CODEX_HOME: join(root, "codex-home") };
  await mkdir(env.CODEX_HOME, { recursive: true });
  const version = parseCodexCliVersion(versionOutput(binary, env));
  if (!version) throw new Error("Codex --version output is no longer recognized by DJL");
  if (!isCodexCliVersionSupported(version))
    throw new Error(`Codex ${version} is below DJL's minimum ${MINIMUM_CODEX_CLI_VERSION}`);
  // Same client, launch arguments and handshake as the native Codex driver.
  const rpc = new NativeRpc(binary, ["app-server"], root, env);
  try {
    const init = object(
      await rpc.request("initialize", {
        clientInfo: { name: "djl_native", title: "DJL", version: "1.0.0" },
      }),
    );
    rpc.notify("initialized");
    const thread = object(object(await rpc.request("thread/start", { cwd: root })).thread);
    string(thread.id);
    console.log(
      `Codex ${version}: version supported, app-server handshake ok (${String(init.userAgent ?? "no user agent")}), thread started`,
    );
  } finally {
    rpc.close();
  }
}

const root = await mkdtemp(join(tmpdir(), "djl-agent-cli-compat-"));
try {
  await checkClaude(option("--claude"), root);
  await checkCodex(option("--codex"), root);
} finally {
  // On Windows a just-closed CLI can hold a file handle briefly; the checks above already passed.
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(
    (error: unknown) => console.warn(`Could not remove ${root}: ${String(error)}`),
  );
}

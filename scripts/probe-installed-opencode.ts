// Run with an explicit CLI path. Uses an isolated home and a loopback model fixture;
// never reads the user's OpenCode credentials or contacts a paid model endpoint.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createOpenCodeCompatibilityPluginSource } from "@synara/shared/openCodeCompatibility";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { evaluateOpenCodeWorkCompatibility } from "./lib/opencode-compatibility.ts";
import { prepareInstalledOpenCodeFixture } from "./lib/installed-opencode-fixture.ts";

interface ModelRequest {
  tools?: Array<{ function: { name: string } }>;
  tool_choice?: unknown;
  messages?: unknown;
}

interface PromptResult {
  parts?: Array<{ type: string; tool?: string; state?: { status?: string; output?: string } }>;
}

const binary = process.argv[2];
const compatibility = process.argv.includes("--compatibility");
const nativeScope = process.argv.includes("--native-scope");
const noTools = process.argv.includes("--no-tools");
const nativePermissions = compatibility || process.argv.includes("--native-permissions");
const format = process.argv.find((arg) => arg.startsWith("--format="))?.slice(9) ?? "json";
const providerID = process.argv.find((arg) => arg.startsWith("--provider="))?.slice(11) ?? "ollama";
if (
  !binary ||
  !isAbsolute(binary) ||
  !["json", "dsml", "tagged"].includes(format) ||
  !["ollama", "lmstudio", "deepseek"].includes(providerID)
) {
  throw new Error(
    "Usage: node scripts/probe-installed-opencode.ts /absolute/path/to/opencode [--native-permissions|--compatibility] [--format=json|dsml|tagged] [--provider=ollama|lmstudio|deepseek]",
  );
}

const root = await realpath(await mkdtemp(join(tmpdir(), "djl-opencode-parity-")));
const project = join(root, "project");
const instructionMarker = "DJL_PARITY_UNTRUSTED_INSTRUCTION_SENTINEL";
const toolResultMarker = "DJL_PARITY_TOOL_RESULT";
const localAgentPrompt =
  "You are DJL fixture local agent. Use tools through their API and answer clearly.";
const requests: Array<ModelRequest> = [];
const mock = createServer(async (request, response) => {
  try {
    if (request.method !== "POST") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "parity", object: "model" }] }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += String(chunk);
    requests.push(JSON.parse(body) as ModelRequest);
    // The first completion is the malformed tool-call text repaired by DJL's fork.
    // A repaired call must execute read and cause a second model request.
    const jsonCall = JSON.stringify({
      name: "read",
      arguments: { filePath: join(project, "fixture.txt") },
    });
    const text =
      requests.length === 1 && !noTools
        ? format === "dsml"
          ? `<｜DSML｜tool_calls><｜DSML｜invoke name="read"><｜DSML｜parameter name="filePath" string="true">${join(project, "fixture.txt")}</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>`
          : format === "tagged"
            ? `<tool_call>${jsonCall}</tool_call>`
            : jsonCall
        : "Fixture read completed.";
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finishReason] of [
      [{ role: "assistant" }, null],
      [{ content: text }, null],
      [{}, "stop"],
    ] as const) {
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-parity",
          object: "chat.completion.chunk",
          created: 1,
          model: "parity",
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`,
      );
    }
    response.end("data: [DONE]\n\n");
  } catch {
    response.writeHead(500);
    response.end("Invalid compatibility fixture request");
  }
});

async function listen(server: Server): Promise<number> {
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback fixture address");
  return address.port;
}

let child: ReturnType<typeof spawn> | undefined;
let childClosed: Promise<unknown> | undefined;
try {
  const port = await listen(mock);
  let cliOutput = "";
  await mkdir(project);
  await prepareInstalledOpenCodeFixture(join(root, "config"));
  await writeFile(join(project, "AGENTS.md"), instructionMarker);
  await writeFile(join(project, "fixture.txt"), toolResultMarker);
  const policyPath = join(root, "policies.json");
  const pluginPath = join(root, "compatibility.ts");
  await writeFile(policyPath, "{}");
  await writeFile(pluginPath, createOpenCodeCompatibilityPluginSource(policyPath));
  const password = randomBytes(24).toString("hex");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: root,
    USERPROFILE: root,
    APPDATA: join(root, "appdata"),
    LOCALAPPDATA: join(root, "localappdata"),
    TMPDIR: root,
    TMP: root,
    TEMP: root,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    // Models are explicitly defined by this loopback fixture; catalog refresh is unrelated.
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      autoupdate: false,
      ...(nativeScope
        ? { agent: { "djl-local": { mode: "primary", hidden: true, prompt: localAgentPrompt } } }
        : {}),
      ...(compatibility ? { plugin: [pathToFileURL(pluginPath).href] } : {}),
      enabled_providers: [providerID],
      provider: {
        [providerID]: {
          npm: "@ai-sdk/openai-compatible",
          name: "Loopback parity fixture",
          options: { baseURL: `http://127.0.0.1:${port}/v1` },
          models: {
            parity: { name: "Parity", tool_call: !noTools, limit: { context: 32768, output: 512 } },
          },
        },
      },
      permission: { "*": "allow" },
    }),
  };
  const version = spawnSync(binary, ["--version"], {
    env,
    cwd: project,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (version.error || version.status !== 0) throw new Error("Official CLI version probe failed");
  child = spawn(binary, ["serve", "--print-logs", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  childClosed = once(child, "close").catch(() => undefined);
  const processHandle = child;
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("OpenCode startup timed out")), 60_000);
    const receive = (chunk: Buffer) => {
      cliOutput = (cliOutput + String(chunk)).slice(-16_384);
      const match = cliOutput.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    processHandle.stdout?.on("data", receive);
    processHandle.stderr?.on("data", receive);
    processHandle.once("error", () => {
      clearTimeout(timer);
      reject(new Error("OpenCode launch failed"));
    });
    processHandle.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("OpenCode exited"));
    });
  });
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    console.log(`OpenCode fixture POST ${path}`);
    const response = await fetch(url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    }).catch((cause: unknown) => {
      const diagnostics = cliOutput.replaceAll(password, "[REDACTED]");
      throw new Error(
        `OpenCode fixture POST ${path} failed after ${requests.length} model requests. CLI output: ${diagnostics}`,
        { cause },
      );
    });
    if (!response.ok) throw new Error(`OpenCode fixture request failed: ${response.status}`);
    return (await response.json()) as T;
  };
  const session = await call<{ id: string }>("/session", {
    title: "Isolated DJL compatibility probe",
    ...(nativePermissions
      ? {
          permission: [
            { permission: "*", pattern: "*", action: "deny" },
            { permission: "read", pattern: "*", action: "allow" },
          ],
        }
      : {}),
  });
  await writeFile(
    policyPath,
    JSON.stringify({
      [session.id]: {
        instructionScope: nativeScope ? "native" : "work-isolated",
        system: ["You are DJL. Use tools to read the requested file."],
        requiredToolCall: !nativeScope && !noTools,
        visibleTools: ["read"],
      },
    }),
  );
  const result = await call<PromptResult>(`/session/${session.id}/message`, {
    ...(nativeScope ? { agent: "djl-local" } : {}),
    model: { providerID, modelID: "parity" },
    parts: [{ type: "text", text: "Read fixture.txt with the read tool." }],
    visibleTools: ["read"],
    requiredToolCall: true,
    instructionScope: "work-isolated",
  });
  const historyResponse = await fetch(`${url}/session/${session.id}/message`, {
    headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
  });
  const history = (await historyResponse.json()) as Array<PromptResult>;
  result.parts = history.flatMap((message) => message.parts ?? []);
  const observation = {
    requestCount: requests.length,
    tools: requests[0]?.tools?.map((tool) => tool.function.name) ?? [],
    toolChoice: requests[0]?.tool_choice ?? null,
    inheritedInstructions: requests.some((request) =>
      JSON.stringify(request.messages).includes(instructionMarker),
    ),
    recoveredToolCompleted:
      result.parts?.some(
        (part) =>
          part.type === "tool" &&
          part.tool === "read" &&
          part.state?.status === "completed" &&
          part.state.output?.includes(toolResultMarker),
      ) ?? false,
  };
  const failures =
    nativeScope || noTools
      ? []
      : evaluateOpenCodeWorkCompatibility(observation, providerID !== "deepseek");
  if (nativeScope && !JSON.stringify(requests[0]?.messages).includes(localAgentPrompt))
    failures.push("local-agent-prompt-missing");
  if (nativeScope && !observation.inheritedInstructions) failures.push("native-instructions-lost");
  if (nativeScope && !noTools && !observation.recoveredToolCompleted)
    failures.push("native-text-call-not-executed");
  if (nativeScope && observation.toolChoice === "required")
    failures.push("native-tool-choice-forced");
  if (
    noTools &&
    requests.some((request) => request.tools?.length || request.tool_choice === "required")
  )
    failures.push("chat-only-model-received-tools");
  if (noTools && observation.requestCount !== 1)
    failures.push("chat-only-model-unexpected-request-count");
  if (!nativeScope && observation.inheritedInstructions)
    failures.push("work-instructions-inherited");
  if (compatibility && requests.slice(1).some((request) => request.tool_choice === "required"))
    failures.push("subsequent-tool-choice-required");
  console.log(
    JSON.stringify(
      {
        version: version.stdout.trim(),
        nativePermissions,
        compatibility,
        nativeScope,
        noTools,
        format,
        providerID,
        observation,
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const forceKill = setTimeout(() => child?.kill("SIGKILL"), 5_000);
    await childClosed;
    clearTimeout(forceKill);
  }
  mock.closeAllConnections();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}

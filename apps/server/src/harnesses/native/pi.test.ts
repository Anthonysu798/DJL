import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPiDriver, writePiPluginExtension } from "./pi";
import type { NativeSink } from "./types";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "djl-pi-test-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const plugins = {
  bearerToken: "pi-chat-token",
  servers: [{ name: "djl_linear", url: "http://127.0.0.1:9999/mcp/linear" }],
};
const sink: NativeSink = { emit: () => {}, request: async () => "decline", fail: () => {} };

// A Pi stand-in that checks how DJL launched it, then answers get_state.
const fakePi = (check: string) => {
  const binary = join(tempDir(), "pi");
  writeFileSync(
    binary,
    `#!${process.execPath}\nconst argv=process.argv.slice(2);${check};require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='get_state')process.stdout.write(JSON.stringify({id:m.id,type:'response',success:true,data:{sessionId:'s',model:{id:'m',provider:'p'}}})+'\\n')});`,
  );
  chmodSync(binary, 0o700);
  return binary;
};

describe("Pi plugins", () => {
  it("loads DJL's plugin extension and hands it the gateway through the environment only", async () => {
    const binary = fakePi(`
      const i=argv.indexOf('-e');
      if(i<0||!argv[i+1].endsWith('djl-plugins.ts'))throw Error('plugin extension missing');
      if(argv.join(' ').includes('pi-chat-token'))throw Error('token on the command line');
      const env=JSON.parse(process.env.DJL_PI_PLUGINS);
      if(env.bearerToken!=='pi-chat-token'||env.servers[0].name!=='djl_linear'||env.askFirst!==false)throw Error('bad env');
      if(process.env.DJL_PI_APPROVE)throw Error('unexpected approvals');
    `);
    const driver = await createPiDriver(
      {
        threadId: ThreadId.makeUnsafe("pi-plugins"),
        cwd: "/tmp",
        runtimeMode: "full-access",
        providerOptions: { pi: { binaryPath: binary } },
      },
      sink,
      undefined,
      plugins,
    );
    driver.close();
  });

  it("asks before plugin tools whenever Pi asks before commands", async () => {
    const binary = fakePi(`
      if(argv.filter(a=>a==='-e').length!==2)throw Error('expected both extensions');
      if(process.env.DJL_PI_APPROVE!=='command')throw Error('bad approvals '+process.env.DJL_PI_APPROVE);
      if(JSON.parse(process.env.DJL_PI_PLUGINS).askFirst!==true)throw Error('plugin tools would not ask');
    `);
    const driver = await createPiDriver(
      {
        threadId: ThreadId.makeUnsafe("pi-plugins"),
        cwd: "/tmp",
        runtimeMode: "accept-edits",
        providerOptions: { pi: { binaryPath: binary } },
      },
      sink,
      undefined,
      plugins,
    );
    driver.close();
  });

  it("the plugin extension registers each gateway tool and calls it through the gateway", async () => {
    const file = writePiPluginExtension(tempDir());
    const extension = (await import(pathToFileURL(file).href)) as {
      default: (pi: unknown) => Promise<void>;
    };
    const methods: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer pi-chat-token");
      const body = JSON.parse(String(init?.body)) as { id?: string; method: string; params: any };
      methods.push(body.method);
      const json = (result: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
          headers: { "content-type": "application/json", "mcp-session-id": "mcp-1" },
        });
      if (body.method === "initialize") return json({});
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list")
        return json({
          tools: [
            {
              name: "create_issue",
              description: "Create a Linear issue",
              inputSchema: { type: "object", properties: { title: { type: "string" } } },
            },
          ],
        });
      expect(headers.get("mcp-session-id")).toBe("mcp-1");
      expect(body.params).toEqual({ name: "create_issue", arguments: { title: "Bug" } });
      return json({ content: [{ type: "text", text: "Created ENG-1" }] });
    });
    const tools: {
      name: string;
      parameters: unknown;
      execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
    }[] = [];
    vi.stubEnv("DJL_PI_PLUGINS", JSON.stringify(plugins));
    try {
      await extension.default({ registerTool: (tool: (typeof tools)[number]) => tools.push(tool) });
      // Read once, then hidden from every command Pi runs later.
      expect(process.env.DJL_PI_PLUGINS).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(tools.map((tool) => tool.name)).toEqual(["djl_linear__create_issue"]);
    expect(tools[0]!.parameters).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
    });
    await expect(tools[0]!.execute("call-1", { title: "Bug" })).resolves.toEqual({
      content: [{ type: "text", text: "Created ENG-1" }],
      details: {},
    });
    expect(methods).toContain("tools/call");
  });

  // Loads DJL's plugin extension against a fake gateway that serves the given tools per server.
  const loadPluginTools = async (
    servers: { name: string; url: string; tools: string[] }[],
    askFirst: boolean,
  ) => {
    const file = writePiPluginExtension(tempDir());
    const extension = (await import(pathToFileURL(file).href)) as {
      default: (pi: unknown) => Promise<void>;
    };
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { id?: string; method: string; params: any };
      const json = (result: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
          headers: { "content-type": "application/json" },
        });
      if (body.method === "initialize") return json({});
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/list")
        return json({
          tools: servers
            .find((server) => server.url === String(url))!
            .tools.map((name) => ({ name, inputSchema: { type: "object" } })),
        });
      calls.push(body.params.name);
      return json({ content: [{ type: "text", text: "ok" }] });
    });
    const tools: {
      name: string;
      execute: (
        id: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: unknown,
      ) => Promise<unknown>;
    }[] = [];
    vi.stubEnv(
      "DJL_PI_PLUGINS",
      JSON.stringify({
        bearerToken: "pi-chat-token",
        servers: servers.map(({ name, url }) => ({ name, url })),
        askFirst,
      }),
    );
    try {
      await extension.default({ registerTool: (tool: (typeof tools)[number]) => tools.push(tool) });
    } finally {
      vi.unstubAllEnvs();
    }
    return { tools, calls };
  };

  it("a plugin tool asks the user itself and never reaches the gateway when declined", async () => {
    const { tools, calls } = await loadPluginTools(
      [{ name: "djl_linear", url: "http://127.0.0.1:9999/mcp/linear", tools: ["create_issue"] }],
      true,
    );
    const confirm = vi.fn(async () => false);
    await expect(
      tools[0]!.execute("call-1", { title: "Bug" }, undefined, undefined, { ui: { confirm } }),
    ).rejects.toThrow("Denied in DJL.");
    expect(confirm).toHaveBeenCalledWith(
      "djl-approval:plugin:djl_linear__create_issue",
      '{"title":"Bug"}',
    );
    expect(calls).toEqual([]);
    // No way to ask is a refusal too.
    await expect(tools[0]!.execute("call-2", {}, undefined, undefined, {})).rejects.toThrow(
      "Denied in DJL.",
    );
    expect(calls).toEqual([]);
  });

  it("a shortened plugin tool name stays unique and still asks first", async () => {
    // Long enough that the shortened name loses the "__" between server and tool.
    const server = `djl_${"a".repeat(60)}`;
    const { tools, calls } = await loadPluginTools(
      [
        {
          name: server,
          url: "http://127.0.0.1:9999/mcp/long",
          tools: ["create_issue_with_a_long_name", "create_issue_with_a_long_name_too"],
        },
      ],
      true,
    );
    expect(tools).toHaveLength(2);
    const [first, second] = tools.map((tool) => tool.name);
    expect(first).toHaveLength(64);
    expect(first).toMatch(/^djl_a{51}_[0-9a-f]{8}$/);
    expect(first).not.toBe(second);
    const confirm = vi.fn(async () => true);
    await tools[0]!.execute("call-1", {}, undefined, undefined, { ui: { confirm } });
    expect(confirm).toHaveBeenCalledWith(`djl-approval:plugin:${first}`, "{}");
    expect(calls).toEqual(["create_issue_with_a_long_name"]);
  });

  it("withholds both tools when two plugin tools would share a name", async () => {
    const { tools } = await loadPluginTools(
      [
        { name: "djl_a__b", url: "http://127.0.0.1:9999/mcp/one", tools: ["c", "kept"] },
        { name: "djl_a", url: "http://127.0.0.1:9999/mcp/two", tools: ["b__c"] },
      ],
      false,
    );
    expect(tools.map((tool) => tool.name)).toEqual(["djl_a__b__kept"]);
  });
});

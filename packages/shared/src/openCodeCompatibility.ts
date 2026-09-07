// OpenCode-derived text tool-call recovery retains the MIT notice in docs/licenses/OPENCODE_LICENSE.
/** Session policy consumed only by the DJL-launched official OpenCode plugin. */
export interface OpenCodeCompatibilityPolicy {
  instructionScope?: "work-isolated" | "native";
  system?: string[];
  requiredToolCall?: boolean;
  visibleTools?: string[];
}

/** Standalone TypeScript plugin: official OpenCode loads local file URLs with Bun. */
export function createOpenCodeCompatibilityPluginSource(policyPath: string): string {
  return `const POLICY_PATH = ${JSON.stringify(policyPath)};\n` + PLUGIN_SOURCE;
}

const PLUGIN_SOURCE = `type LocalTextToolCall = { readonly name: string; readonly arguments: Record<string, unknown> };
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^\`\`\`(?:json)?\\s*/iu, "")
    .replace(/\\s*\`\`\`$/u, "")
    .trim();
}

function splitJsonObjects(text: string): string[] | undefined {
  const input = text.trim();
  const objects: string[] = [];
  let index = 0;

  while (index < input.length) {
    while (/\\s/u.test(input[index] ?? "")) index += 1;
    if (input[index] !== "{") return objects.length > 0 ? objects : undefined;
    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (; index < input.length; index += 1) {
      const character = input[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          objects.push(input.slice(start, index));
          break;
        }
      }
    }
    if (depth !== 0 || inString) return undefined;
  }
  return objects.length > 0 ? objects : undefined;
}

function decodeDsmlText(text: string): string {
  return text
    .replace(/&quot;/gu, '"')
    .replace(/&apos;|&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function dsmlToolCallJsonBlocks(text: string): string[] | undefined {
  const match =
    /^<｜{1,2}DSML｜{1,2}tool_calls>\\s*([\\s\\S]*?)\\s*<\\/｜{1,2}DSML｜{1,2}tool_calls>$/u.exec(
      stripCodeFence(text),
    );
  if (!match) return undefined;

  const calls: string[] = [];
  const remainder = match[1].replace(
    /<｜{1,2}DSML｜{1,2}invoke\\s+name="([\\w.-]+)">\\s*([\\s\\S]*?)\\s*<\\/｜{1,2}DSML｜{1,2}invoke>/gu,
    (_invoke, name: string, body: string) => {
      const args: Record<string, unknown> = {};
      let valid = true;
      const parameterRemainder = body.replace(
        /<｜{1,2}DSML｜{1,2}parameter\\s+name="([\\w.-]+)"\\s+string="(true|false)">\\s*([\\s\\S]*?)\\s*<\\/｜{1,2}DSML｜{1,2}parameter>/gu,
        (_parameter, parameterName: string, isString: string, value: string) => {
          const decoded = decodeDsmlText(value);
          if (isString === "true") {
            args[parameterName] = decoded;
            return "";
          }
          try {
            args[parameterName] = JSON.parse(decoded);
          } catch {
            valid = false;
          }
          return "";
        },
      );
      if (!valid || parameterRemainder.trim().length > 0) return _invoke;
      calls.push(JSON.stringify({ name, arguments: args }));
      return "";
    },
  );
  return remainder.trim().length === 0 && calls.length > 0 ? calls : undefined;
}

function toolCallJsonBlocks(text: string): string[] | undefined {
  const normalized = stripCodeFence(text);
  const dsml = dsmlToolCallJsonBlocks(normalized);
  if (dsml) return dsml;
  if (!normalized.includes("<tool_call>")) return splitJsonObjects(normalized);

  const blocks: string[] = [];
  const remainder = normalized.replace(
    /<tool_call>\\s*([\\s\\S]*?)\\s*<\\/tool_call>/giu,
    (_match, json: string) => {
      blocks.push(json);
      return "";
    },
  );
  return remainder.trim().length === 0 && blocks.length > 0 ? blocks : undefined;
}

function invalidMalformedCall(
  text: string,
  byLowercaseName: ReadonlyMap<string, string>,
): LocalTextToolCall | undefined {
  const malformedName =
    /^(?:<tool_call>\\s*)?\\{\\s*"(?:name|function_name)"\\s*:\\s*"([\\w.-]+)"/iu.exec(
      stripCodeFence(text),
    )?.[1];
  const invalid = byLowercaseName.get("invalid");
  if (!malformedName || !invalid) return undefined;
  return {
    name: invalid,
    arguments: {
      tool: malformedName,
      error: \`The local model returned an incomplete or malformed call to "\${malformedName}".\`,
    },
  };
}

function parseLocalTextToolCalls(
  text: string,
  availableTools: ReadonlySet<string>,
): LocalTextToolCall[] | undefined {
  const blocks = toolCallJsonBlocks(text);
  const byLowercaseName = new Map([...availableTools].map((name) => [name.toLowerCase(), name]));
  if (!blocks) {
    const invalid = invalidMalformedCall(text, byLowercaseName);
    return invalid ? [invalid] : undefined;
  }

  const calls: LocalTextToolCall[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      const invalid = invalidMalformedCall(block, byLowercaseName);
      if (!invalid) return undefined;
      calls.push(invalid);
      continue;
    }
    const value = record(parsed);
    const requestedName =
      value && typeof value.name === "string"
        ? value.name
        : value && typeof value.function_name === "string"
          ? value.function_name
          : undefined;
    if (!value || !requestedName) return undefined;
    const name = byLowercaseName.get(requestedName.toLowerCase());
    const invalid = byLowercaseName.get("invalid");
    if (!name) {
      if (!invalid) return undefined;
      const args = {
        tool: requestedName,
        error: \`Unknown tool "\${requestedName}" requested by the local model.\`,
      };
      const key = \`\${invalid}:\${JSON.stringify(args)}\`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({ name: invalid, arguments: args });
      continue;
    }
    let rawArguments = value.arguments;
    if (typeof rawArguments === "string") {
      try {
        rawArguments = JSON.parse(rawArguments);
      } catch {
        return undefined;
      }
    }
    const args = record(rawArguments);
    if (!args) return undefined;
    const key = \`\${name}:\${JSON.stringify(args)}\`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ name, arguments: args });
  }
  return calls.length > 0 ? calls : undefined;
}

export default async function DJLCompatibility() {
  const fs = await import('node:fs/promises');
  const policies = async () => {
    try { return JSON.parse(await fs.readFile(POLICY_PATH, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  };
  const tokens = new Map();
  const usedTurns = new Set();
  const wrappedProviders = new Map();
  const header = 'x-djl-compatibility-context';
  return {
    async config(config) {
      config.provider ??= {};
      config.provider.deepseek ??= {};
      for (const [id, provider] of Object.entries(config.provider ?? {})) {
        if (!['ollama', 'lmstudio', 'deepseek'].includes(id.toLowerCase())) continue;
        provider.options ??= {};
        const original = provider.options.fetch ?? globalThis.fetch;
        provider.options.fetch = async (url, init) => {
          const headers = new Headers(init?.headers);
          const token = headers.get(header);
          headers.delete(header);
          const context = tokens.get(token);
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
          const aliases = new Map();
          if (body && context) {
            if (context.policy?.visibleTools) {
              const visible = context.policy.visibleTools;
              body.tools = (body.tools ?? []).flatMap(tool => {
                const actual = tool.function.name;
                const candidates = visible.includes(actual) ? [actual] : visible.filter(name => actual.endsWith('_' + name) && !(body.tools ?? []).some(other => other.function.name === name));
                if (candidates.length !== 1) return [];
                const alias = candidates[0];
                if (actual !== alias && (body.tools ?? []).filter(other => other.function.name.endsWith('_' + alias)).length !== 1) return [];
                aliases.set(alias, actual);
                return [{...tool,function:{...tool.function,name:alias}}];
              });
              for (const message of body.messages ?? []) {
                for (const call of message.tool_calls ?? []) {
                  for (const [alias, actual] of aliases) if (call.function?.name === actual) call.function.name = alias;
                }
              }
            }
            if (context.policy?.instructionScope === 'work-isolated') {
              body.messages = [
                ...(context.policy.system ?? []).map(content => ({role:'system',content})),
                ...(body.messages ?? []).filter(message => message.role !== 'system' && message.role !== 'developer'),
              ];
            }
            // Preserve automatic choice for remote DeepSeek reasoning APIs; DJL still verifies successful tool evidence.
            if (['ollama', 'lmstudio'].includes(id.toLowerCase()) && context.policy?.requiredToolCall && !usedTurns.has(context.turn) && body.tools?.length) body.tool_choice = 'required';
            if (context.toolcall === false) { delete body.tools; delete body.tool_choice; }
          }
          const response = await original(url, {...init, headers, ...(body ? {body:JSON.stringify(body)} : {})});
          if (response.ok && body?.tools?.length && context) usedTurns.add(context.turn);
          if (!response.ok || !body?.stream || !body.tools?.length || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
          return transformResponse(response, new Set(body.tools.map(tool => tool.function.name)), aliases);
        };
        wrappedProviders.set(id, provider.options.fetch);
      }
    },
    async 'experimental.chat.system.transform'(input, output) {
      const policy = (await policies())[input.sessionID];
      if (policy?.instructionScope === 'work-isolated') output.system.splice(0, output.system.length, ...(policy.system ?? []));
    },
    async 'tool.execute.after'(input, output) {
      if (input.tool === 'websearch') output.output = output.output.trim() + '\\n\\nRetrieved at: ' + new Date().toISOString();
    },
    async 'chat.headers'(input, output) {
      if (!wrappedProviders.has(input.model.providerID)) return;
      if (input.provider?.options?.fetch && input.provider.options.fetch !== wrappedProviders.get(input.model.providerID)) throw new Error('DJL compatibility transport was overridden by another provider plugin.');
      const token = crypto.randomUUID();
      if (tokens.size >= 512) tokens.delete(tokens.keys().next().value);
      if (usedTurns.size >= 512) usedTurns.delete(usedTurns.values().next().value);
      tokens.set(token, {policy:(await policies())[input.sessionID], turn:input.message.id, toolcall:input.model.capabilities?.toolcall});
      output.headers[header] = token;
    },
  };
}

function transformResponse(response, tools, aliases) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  let text = '';
  let mode = 'undecided';
  let buffered = [];
  let native = false;
  let recovered = false;
  const emit = (controller, event) => controller.enqueue(encoder.encode(event + '\\n\\n'));
  const flushText = controller => { for (const event of buffered) emit(controller,event); buffered=[]; };
  const finish = (controller, chunk) => {
    const calls = !native && mode !== 'streaming' ? parseLocalTextToolCalls(text, tools) : undefined;
    if (!calls) { flushText(controller); return; }
    recovered = true;
    buffered = [];
    emit(controller, 'data: ' + JSON.stringify({...chunk, choices:[{index:0,delta:{tool_calls:calls.map((call,index)=>({index,id:'djl-local-'+crypto.randomUUID(),type:'function',function:{name:aliases.get(call.name) ?? call.name,arguments:JSON.stringify(call.arguments)}}))},finish_reason:null}]}));
  };
  const event = (controller, raw) => {
    const data = raw.split('\\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\\n');
    if (!data || data === '[DONE]') { flushText(controller); emit(controller,raw); return; }
    let chunk;
    try { chunk=JSON.parse(data); } catch { flushText(controller); emit(controller,raw); return; }
    const choice=chunk.choices?.[0];
    if (choice?.delta?.tool_calls?.length) {
      native=true;flushText(controller);
      for (const call of choice.delta.tool_calls) if (call.function?.name && aliases.has(call.function.name)) call.function.name = aliases.get(call.function.name);
      raw = 'data: ' + JSON.stringify(chunk);
    }
    let held = false;
    const content=choice?.delta?.content;
    if (typeof content === 'string' && !native && mode !== 'streaming') {
      text+=content; buffered.push(raw); held = true;
      const trimmed=text.trimStart();
      if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('<') && !trimmed.startsWith('\`\`\`')) {mode='streaming';flushText(controller);}
      if (!choice.finish_reason) return;
    }
    if (choice?.finish_reason) {
      finish(controller,chunk);
      if (recovered) {
        choice.finish_reason='tool_calls';
        choice.delta={...choice.delta};
        delete choice.delta.content;
        emit(controller,'data: '+JSON.stringify(chunk));return;
      }
    }
    if (!held) emit(controller,raw);
  };
  const stream=response.body.pipeThrough(new TransformStream({
    transform(chunk,controller) {
      pending += decoder.decode(chunk,{stream:true});
      pending = pending.replace(/\\r\\n/g,'\\n');
      let end;
      while ((end=pending.indexOf('\\n\\n'))>=0) {const raw=pending.slice(0,end);pending=pending.slice(end+2);event(controller,raw);}
    },
    flush(controller) {pending+=decoder.decode();if(pending)event(controller,pending);flushText(controller);},
  }));
  const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
  return new Response(stream,{status:response.status,statusText:response.statusText,headers});
}
`;

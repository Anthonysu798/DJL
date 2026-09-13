/**
 * DJL Cloud native driver: streams OpenAI-compatible chat completions from
 * the DJL Cloud gateway using the stored account session. Text prompts only
 * in this cut; tool execution arrives with the cloud runner.
 */
import type { ProviderListModelsResult, ProviderModelDescriptor } from "@synara/contracts";
import { randomUUID } from "node:crypto";

import { CloudApiError, createCloudClient, type FetchLike } from "../../cloud/api";
import { readCloudSession, type CloudSession } from "../../cloud/session";
import type { NativeDriver, NativeDriverFactory, NativeSink } from "./types";

interface CloudModel {
  id: string;
  provider: string;
  displayName: string;
  capabilities: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;
  status: "active" | "degraded" | "disabled";
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DjlCloudDriverDeps {
  readonly secretsDir: string;
  readonly fetchImpl?: FetchLike;
}

const SYSTEM_PROMPT =
  "You are DJL, a helpful assistant inside the DJL desktop app. Answer directly and concisely.";

export function toModelDescriptor(model: CloudModel): ProviderModelDescriptor {
  return {
    slug: model.id,
    name: model.displayName,
    upstreamProviderId: model.provider,
    supportsToolCalls: model.capabilities.includes("tools"),
    supportsVision: model.capabilities.includes("vision"),
    supportsAttachments: false,
    processingLocality: "remote",
    ...(model.contextWindow ? { contextLimitTokens: model.contextWindow } : {}),
  };
}

async function requireSession(secretsDir: string): Promise<CloudSession> {
  const session = await readCloudSession(secretsDir);
  if (!session) throw new Error("Sign in to DJL Cloud in Settings → Accounts to use cloud models.");
  return session;
}

export const createDjlCloudDriverFactory =
  (deps: DjlCloudDriverDeps): NativeDriverFactory =>
  async (input, sink: NativeSink): Promise<NativeDriver> => {
    const session = await requireSession(deps.secretsDir);
    const client = createCloudClient(session.apiBaseUrl, deps.fetchImpl);
    const history: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
    let model = input.modelSelection?.model ?? "claude-sonnet-5";
    let controller: AbortController | null = null;

    return {
      id: randomUUID(),
      async send(request) {
        if (request.modelSelection?.model) model = request.modelSelection.model;
        history.push({ role: "user", content: request.input! });
        controller = new AbortController();
        const itemId = `assistant-${randomUUID()}`;
        let reply = "";
        let cutOff = false;
        let errorMessage: string | null = null;
        try {
          const response = await client.stream(
            "/v1/chat/completions",
            { model, messages: history, stream: true, max_tokens: 4096 },
            session.token,
            controller.signal,
          );
          if (!response.body) throw new Error("DJL Cloud returned an empty stream.");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let index: number;
            while ((index = buffer.indexOf("\n\n")) >= 0) {
              const block = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);
              const event = block.match(/^event: (.+)$/m)?.[1] ?? null;
              const data = block.match(/^data: (.+)$/m)?.[1] ?? "";
              if (!data || data === "[DONE]") continue;
              if (event === "error") {
                const parsed = JSON.parse(data) as { error?: { code?: string; message?: string } };
                if (parsed.error?.code === "insufficient_credits") cutOff = true;
                else errorMessage = parsed.error?.message ?? "DJL Cloud returned an error.";
                continue;
              }
              if (event === "djl.usage") {
                const usage = JSON.parse(data) as { settled: string; remaining: string; cutOff: boolean };
                sink.emit({
                  type: "item.completed",
                  itemId: `usage-${itemId}`,
                  payload: { itemType: "dynamic_tool_call", status: "completed", title: "DJL Cloud usage", data: usage },
                });
                continue;
              }
              const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                reply += delta;
                sink.emit({ type: "content.delta", itemId, payload: { streamKind: "assistant_text", delta } });
              }
            }
          }
        } catch (error) {
          if (controller.signal.aborted) {
            sink.emit({ type: "turn.completed", payload: { state: "interrupted" } });
            if (reply) history.push({ role: "assistant", content: reply });
            return;
          }
          if (error instanceof CloudApiError) {
            const code = error.detail.code;
            if (code === "insufficient_credits") throw new Error("You are out of DJL Cloud credits. Add credits in Settings → Accounts.");
            if (error.detail.status === 401) throw new Error("Your DJL Cloud session expired. Sign in again in Settings → Accounts.");
            if (code === "gateway_paused") throw new Error("DJL Cloud is temporarily paused. Try again shortly.");
            throw new Error(error.detail.message);
          }
          throw error;
        } finally {
          controller = null;
        }
        if (reply) history.push({ role: "assistant", content: reply });
        if (cutOff) throw new Error("DJL Cloud credits ran out during this reply. Add credits to continue.");
        if (errorMessage) throw new Error(errorMessage);
      },
      async interrupt() {
        controller?.abort();
      },
      close() {
        controller?.abort();
      },
      async models(): Promise<ProviderListModelsResult> {
        const result = await client.get<{ models: CloudModel[] }>("/v1/models", session.token);
        return {
          models: result.models.filter((m) => m.status !== "disabled" && m.capabilities.includes("text.chat")).map(toModelDescriptor),
          source: "djl-cloud",
        };
      },
    };
  };

/** Model listing without an active session, used by discovery when signed in. */
export async function listDjlCloudModels(deps: DjlCloudDriverDeps): Promise<ProviderListModelsResult> {
  const session = await requireSession(deps.secretsDir);
  const client = createCloudClient(session.apiBaseUrl, deps.fetchImpl);
  const result = await client.get<{ models: CloudModel[] }>("/v1/models", session.token);
  return { models: result.models.filter((m) => m.status !== "disabled").map(toModelDescriptor), source: "djl-cloud" };
}

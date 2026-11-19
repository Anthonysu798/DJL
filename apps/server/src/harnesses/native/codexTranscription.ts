import type {
  ProviderStartOptions,
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
} from "@synara/contracts";
import { transcribeVoiceWithChatGptSession } from "../../voiceTranscription";
import { NativeRpc, object } from "./protocol";

/** Resolves private ChatGPT auth through the same configured native account used for chat. */
export async function transcribeNativeCodexVoice(
  request: ServerVoiceTranscriptionInput,
  profile: ProviderStartOptions,
  fetchImpl?: typeof fetch,
): Promise<ServerVoiceTranscriptionResult> {
  if (request.provider !== "codex")
    throw new Error("Native Codex transcription requires provider 'codex'.");
  let rpc: NativeRpc | undefined;
  try {
    return await transcribeVoiceWithChatGptSession({
      request,
      ...(fetchImpl ? { fetchImpl } : {}),
      resolveAuth: async (refreshToken) => {
        if (!rpc) {
          const options = profile.codex;
          rpc = new NativeRpc(
            options?.binaryPath ?? "codex",
            ["app-server"],
            request.cwd,
            options?.homePath ? { ...process.env, CODEX_HOME: options.homePath } : process.env,
          );
          await rpc.request("initialize", {
            clientInfo: { name: "djl_voice", title: "DJL", version: "1.0.0" },
          });
          rpc.notify("initialized");
        }
        const readAuth = async (refresh: boolean) => {
          const response = object(
            await rpc!.request("getAuthStatus", { includeToken: true, refreshToken: refresh }),
          );
          return {
            method: typeof response.authMethod === "string" ? response.authMethod : "",
            token: typeof response.authToken === "string" ? response.authToken.trim() : "",
          };
        };
        let auth = await readAuth(refreshToken);
        if (!auth.token && !refreshToken) auth = await readAuth(true);
        if (!auth.token)
          throw new Error("No ChatGPT session token is available. Sign in to ChatGPT in Codex.");
        if (auth.method !== "chatgpt" && auth.method !== "chatgptAuthTokens")
          throw new Error("Voice transcription requires a ChatGPT-authenticated Codex session.");
        return { token: auth.token };
      },
    });
  } finally {
    rpc?.close();
  }
}

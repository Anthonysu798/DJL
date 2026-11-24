import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { CustomModelProvider } from "@djl/contracts";

export async function readCustomProviders(
  root: string,
): Promise<ReadonlyArray<CustomModelProvider>> {
  try {
    return Schema.decodeUnknownSync(Schema.Array(CustomModelProvider))(
      JSON.parse(await readFile(join(root, "custom-providers.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function customProviderConfig(provider: CustomModelProvider) {
  return {
    name: provider.name,
    npm: {
      "openai-chat": "@ai-sdk/openai-compatible",
      "openai-responses": "@ai-sdk/openai",
      anthropic: "@ai-sdk/anthropic",
    }[provider.protocol],
    options: { baseURL: provider.baseUrl.replace(/\/+$/, "") },
    models: Object.fromEntries(
      provider.models.map((model) => [model.id, { id: model.id, name: model.name }]),
    ),
  };
}

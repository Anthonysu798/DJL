import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CustomModelProvider, SaveCustomModelProviderInput } from "./providerDiscovery";

const valid = {
  providerId: "my-relay",
  name: "My relay",
  baseUrl: "https://relay.test/v1",
  protocol: "openai-chat",
  models: [{ id: "org/model", name: "Model" }],
};
describe("custom model provider contracts", () => {
  it("accepts an optional secret only on save and strips it from public definitions", () => {
    expect(
      Schema.decodeUnknownSync(SaveCustomModelProviderInput)({ ...valid, apiKey: "secret" }),
    ).toHaveProperty("apiKey", "secret");
    expect(
      Schema.decodeUnknownSync(CustomModelProvider)({ ...valid, apiKey: "secret" }),
    ).not.toHaveProperty("apiKey");
  });
  it("rejects invalid IDs, unsafe URLs, unsupported protocols, and duplicate models", () => {
    for (const patch of [
      { providerId: "../relay" },
      { providerId: "__proto__" },
      { providerId: "Uppercase" },
      { baseUrl: "file:///etc/passwd" },
      { baseUrl: "https://user:secret@relay.test/v1" },
      { baseUrl: "https://relay.test/v1?key=secret" },
      { protocol: "unknown" },
      { models: [valid.models[0], valid.models[0]] },
    ])
      expect(() => Schema.decodeUnknownSync(CustomModelProvider)({ ...valid, ...patch })).toThrow();
  });
});

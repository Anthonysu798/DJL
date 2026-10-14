import { Schema } from "effect";

export const CloudClientConfig = Schema.Struct({
  auth: Schema.Struct({ google: Schema.Boolean, apple: Schema.Boolean }),
  tools: Schema.Struct({
    imageGeneration: Schema.Boolean,
    imageEditing: Schema.Boolean,
    fileParsing: Schema.Boolean,
  }),
  pushConfigured: Schema.Boolean,
  policyUrls: Schema.Struct({
    terms: Schema.NullOr(Schema.String),
    privacy: Schema.NullOr(Schema.String),
  }),
});
export type CloudClientConfig = typeof CloudClientConfig.Type;

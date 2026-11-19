import { Schema } from "effect";

export const CloudClientConfig = Schema.Struct({
  auth: Schema.Struct({ google: Schema.Boolean, apple: Schema.Boolean }),
  tools: Schema.Struct({
    imageGeneration: Schema.Boolean,
    imageEditing: Schema.Boolean,
    fileParsing: Schema.Boolean,
  }),
  pushConfigured: Schema.Boolean,
  pushProviders: Schema.optionalKey(Schema.Array(Schema.Literals(["apns", "fcm"]))),
  policyUrls: Schema.Struct({
    terms: Schema.NullOr(Schema.String),
    privacy: Schema.NullOr(Schema.String),
  }),
});
export type CloudClientConfig = typeof CloudClientConfig.Type;

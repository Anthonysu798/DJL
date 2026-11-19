/** Model-facing wire schemas mirror the public MultiPost contracts. */
const string = { type: "string" };
const integer = { type: "integer", minimum: 1 };
export const kindSchema = { type: "string", enum: ["dynamic", "article", "video", "podcast"] };
const file = {
  type: "object",
  properties: {
    name: string,
    url: {
      type: "string",
      description:
        "Use a Media/ reference returned by djl_multipost_import_media, an authorized workspace file, or HTTPS media.",
    },
    type: string,
    size: { type: "integer", minimum: 0 },
  },
  required: ["name", "url"],
  additionalProperties: false,
};
const fileList = { type: "array", items: file };
const contentProperties = {
  title: { type: "string", maxLength: 500 },
  content: string,
  description: string,
  digest: string,
  htmlContent: string,
  markdownContent: string,
  images: fileList,
  videos: fileList,
  video: file,
  audio: file,
  cover: file,
  verticalCover: file,
  horizontalCover: file,
  wordFileData: file,
  tags: { type: "array", items: string },
  category: { type: ["string", "number"] },
  collectionId: { type: ["string", "number"] },
  original: { type: "boolean" },
  allowComment: { type: "boolean" },
  scheduledPublishTime: {
    type: "number",
    minimum: 0,
    description:
      "Platform-native schedule as Unix milliseconds; only use on adapters that advertise support. Do not combine with local scheduling.",
  },
};
export const contentSchema = {
  type: "object",
  properties: contentProperties,
  required: ["title"],
  additionalProperties: false,
};
export const targetSchema = {
  type: "object",
  properties: {
    accountId: string,
    adapterId: {
      type: "string",
      description: "Exact adapter id returned by capabilities, e.g. DYNAMIC_X.",
    },
    extraConfig: {
      type: "object",
      description:
        "Adapter-specific options such as selectedTopic, selectedGroupIds, customInjectUrls or urls. Secret destinations belong in the user UI.",
    },
    overrides: { type: "object", properties: contentProperties, additionalProperties: false },
  },
  required: ["accountId", "adapterId"],
  additionalProperties: false,
};
export const draftSchema = {
  type: "object",
  properties: {
    id: string,
    revision: integer,
    kind: kindSchema,
    data: contentSchema,
    targets: { type: "array", items: targetSchema, minItems: 1, maxItems: 100 },
    publicationMode: { type: "string", enum: ["now", "scheduled"] },
    scheduledAt: {
      type: ["string", "null"],
      description:
        "null for now; otherwise a future ISO timestamp with explicit Z or offset. Stored as UTC.",
    },
    timezone: {
      type: "string",
      description:
        "IANA timezone, e.g. America/Toronto; read current localTimezone from capabilities.",
    },
    workflowId: string,
    workflowRevision: integer,
    replaceContent: {
      type: "boolean",
      description:
        "Default false merges copy-only edits and preserves media. Set true only to intentionally replace complete content.",
    },
  },
  required: ["kind", "data", "targets", "publicationMode", "scheduledAt", "timezone"],
  additionalProperties: false,
};
export const workflowSchema = {
  type: "object",
  properties: {
    id: string,
    revision: integer,
    name: { type: "string", minLength: 1, maxLength: 200 },
    kinds: { type: "array", items: kindSchema, minItems: 1 },
    accountIds: { type: "array", items: string, minItems: 1 },
    preparationWorkflowId: string,
  },
  required: ["name", "kinds", "accountIds"],
  additionalProperties: false,
};

// FILE: plugins.ts
// Purpose: Schema-only contracts for DJL-owned plugins: the catalog, install state and app
//          connections. The catalog is the same for every agent harness.

import { Cause, Exit, Schema, SchemaIssue } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

export const PluginAppAuthType = Schema.Literals(["oauth", "apiKey", "none"]);
export type PluginAppAuthType = typeof PluginAppAuthType.Type;

export const PluginAppTransport = Schema.Union([
  Schema.Struct({ type: Schema.Literal("http"), url: TrimmedNonEmptyString }),
  // Served by DJL itself (the built-in work tools); nothing to connect.
  Schema.Struct({ type: Schema.Literal("builtin") }),
]);
export type PluginAppTransport = typeof PluginAppTransport.Type;

export const PluginApp = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  transport: PluginAppTransport,
  auth: PluginAppAuthType,
  /** For "apiKey" apps: the vendor page where the user creates the token. */
  tokenUrl: Schema.optional(TrimmedNonEmptyString),
  /** For "apiKey" apps: the scopes or permissions to pick on that page. */
  tokenScopes: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type PluginApp = typeof PluginApp.Type;

export const PluginSkillSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
});
export type PluginSkillSummary = typeof PluginSkillSummary.Type;

export const PluginCatalogEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  // The @mention handle.
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  shortDescription: TrimmedNonEmptyString,
  longDescription: Schema.optional(TrimmedNonEmptyString),
  category: TrimmedNonEmptyString,
  featured: Schema.Boolean,
  builtIn: Schema.Boolean,
  developer: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  websiteUrl: Schema.optional(TrimmedNonEmptyString),
  privacyPolicyUrl: Schema.optional(TrimmedNonEmptyString),
  termsOfServiceUrl: Schema.optional(TrimmedNonEmptyString),
  brandColor: Schema.optional(TrimmedNonEmptyString),
  // The site whose icon stands for a plugin that has no website of its own, such as
  // DJL's Word plugin, which carries the Word logo.
  iconDomain: Schema.optional(TrimmedNonEmptyString),
  capabilities: Schema.Array(TrimmedNonEmptyString),
  examplePrompts: Schema.Array(TrimmedNonEmptyString),
  apps: Schema.Array(PluginApp),
  skills: Schema.Array(PluginSkillSummary),
});
export type PluginCatalogEntry = typeof PluginCatalogEntry.Type;

export const PluginSourceKind = Schema.Literals(["djl", "marketplace", "personal"]);
export type PluginSourceKind = typeof PluginSourceKind.Type;

export const PluginSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: PluginSourceKind,
  name: TrimmedNonEmptyString,
  /** Where a marketplace's list is fetched from. */
  url: Schema.optional(TrimmedNonEmptyString),
  plugins: Schema.Array(PluginCatalogEntry),
});
export type PluginSource = typeof PluginSource.Type;

export const InstalledPlugin = Schema.Struct({
  pluginId: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  installedAt: IsoDateTime,
});
export type InstalledPlugin = typeof InstalledPlugin.Type;

export const PluginAppConnectionState = Schema.Literals([
  "not_connected",
  "connecting",
  "connected",
  "expired",
  "error",
]);
export type PluginAppConnectionState = typeof PluginAppConnectionState.Type;

export const PluginAppConnection = Schema.Struct({
  pluginId: TrimmedNonEmptyString,
  appId: TrimmedNonEmptyString,
  state: PluginAppConnectionState,
  message: Schema.optional(TrimmedNonEmptyString),
  connectedAt: Schema.optional(IsoDateTime),
});
export type PluginAppConnection = typeof PluginAppConnection.Type;

const PluginsSnapshotStruct = Schema.Struct({
  sources: Schema.Array(PluginSource),
  // User-installed plugins only; built-in plugins are always available.
  installed: Schema.Array(InstalledPlugin),
  connections: Schema.Array(PluginAppConnection),
});
// Named types: every plugin call returns the snapshot, and without a name its whole shape is
// written out once per call in the RPC group's declaration, which overflows what tsc can emit.
export interface PluginsSnapshot extends Schema.Schema.Type<typeof PluginsSnapshotStruct> {}
export const PluginsSnapshot: Schema.Codec<PluginsSnapshot> = PluginsSnapshotStruct;

const PluginIdInputFields = { pluginId: TrimmedNonEmptyString };
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginIdInputSchema extends Schema.Struct<typeof PluginIdInputFields> {}
export const PluginIdInput: PluginIdInputSchema = Schema.Struct(PluginIdInputFields);
export type PluginIdInput = typeof PluginIdInput.Type;

const PluginSetEnabledInputFields = {
  pluginId: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
};
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginSetEnabledInputSchema extends Schema.Struct<
  typeof PluginSetEnabledInputFields
> {}
export const PluginSetEnabledInput: PluginSetEnabledInputSchema = Schema.Struct(
  PluginSetEnabledInputFields,
);
export type PluginSetEnabledInput = typeof PluginSetEnabledInput.Type;

/** A tool server the user adds by address because it is not in the catalog. */
const PluginCustomServerInputFields = {
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  /** Sent as a bearer token on every call. Left out for open servers and ones that sign in. */
  accessToken: Schema.optional(Schema.String),
};
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginCustomServerInputSchema extends Schema.Struct<
  typeof PluginCustomServerInputFields
> {}
export const PluginCustomServerInput: PluginCustomServerInputSchema = Schema.Struct(
  PluginCustomServerInputFields,
);
export type PluginCustomServerInput = typeof PluginCustomServerInput.Type;

/** A skill the user writes in DJL: when to use it, and what the agent should do. */
const PluginCreateSkillInputFields = {
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  instructions: TrimmedNonEmptyString,
};
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginCreateSkillInputSchema extends Schema.Struct<
  typeof PluginCreateSkillInputFields
> {}
export const PluginCreateSkillInput: PluginCreateSkillInputSchema = Schema.Struct(
  PluginCreateSkillInputFields,
);
export type PluginCreateSkillInput = typeof PluginCreateSkillInput.Type;

const PluginCreateSkillResultStruct = Schema.Struct({ name: Schema.String, path: Schema.String });
export interface PluginCreateSkillResult extends Schema.Schema.Type<
  typeof PluginCreateSkillResultStruct
> {}
export const PluginCreateSkillResult: Schema.Codec<PluginCreateSkillResult> =
  PluginCreateSkillResultStruct;

const PluginAppInputFields = {
  pluginId: TrimmedNonEmptyString,
  appId: TrimmedNonEmptyString,
};
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginAppInputSchema extends Schema.Struct<typeof PluginAppInputFields> {}
export const PluginAppInput: PluginAppInputSchema = Schema.Struct(PluginAppInputFields);
export type PluginAppInput = typeof PluginAppInput.Type;

const PluginConnectResultStruct = Schema.Struct({
  snapshot: PluginsSnapshot,
  // The sign-in page to open in the user's browser.
  authorizeUrl: TrimmedNonEmptyString,
  // For a device sign-in: the code the user confirms on that page. DJL waits for the approval
  // itself, so the connection turns "connected" without anything coming back through the browser.
  userCode: Schema.optional(TrimmedNonEmptyString),
});
export interface PluginConnectResult extends Schema.Schema.Type<typeof PluginConnectResultStruct> {}
export const PluginConnectResult: Schema.Codec<PluginConnectResult> = PluginConnectResultStruct;

/** A token the user pasted for an app that takes one instead of a browser sign-in. */
const PluginAppTokenInputFields = {
  pluginId: TrimmedNonEmptyString,
  appId: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
};
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginAppTokenInputSchema extends Schema.Struct<
  typeof PluginAppTokenInputFields
> {}
export const PluginAppTokenInput: PluginAppTokenInputSchema =
  Schema.Struct(PluginAppTokenInputFields);
export type PluginAppTokenInput = typeof PluginAppTokenInput.Type;

// ---------------------------------------------------------------------------------------------
// Plugin manifests: the JSON a user uploads, and what a marketplace lists.

const MANIFEST_HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const isLoopbackHost = (host: string) =>
  host === "127.0.0.1" || host === "localhost" || host === "[::1]";

/** https, or plain http only for a server on this computer; never with a user name in it. */
export const isAllowedPluginServerUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname)))
    );
  } catch {
    return false;
  }
};

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const ManifestText = (maxLength: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(maxLength));
const ManifestHandle = TrimmedNonEmptyString.check(
  Schema.makeFilter(
    (value: string) =>
      MANIFEST_HANDLE.test(value) ||
      "Use up to 63 lowercase letters, numbers and hyphens, starting with a letter or number",
  ),
);

export const PluginManifestServer = Schema.Struct({
  name: ManifestText(80),
  url: TrimmedNonEmptyString.check(
    Schema.makeFilter(
      (value: string) =>
        isAllowedPluginServerUrl(value) ||
        "Use an address that starts with https:// (http:// only for localhost)",
    ),
  ),
});
export type PluginManifestServer = typeof PluginManifestServer.Type;

export const PluginManifestSkill = Schema.Struct({
  name: ManifestText(64),
  description: ManifestText(1_000),
  instructions: ManifestText(24_000),
});
export type PluginManifestSkill = typeof PluginManifestSkill.Type;

const PluginManifestStruct = Schema.Struct({
  id: ManifestHandle,
  // The @mention handle.
  name: ManifestHandle,
  displayName: ManifestText(80),
  shortDescription: ManifestText(160),
  longDescription: Schema.optional(ManifestText(2_000)),
  websiteUrl: Schema.optional(
    TrimmedNonEmptyString.check(
      Schema.makeFilter((value: string) => isHttpsUrl(value) || "Use an https:// address"),
    ),
  ),
  brandColor: Schema.optional(
    TrimmedNonEmptyString.check(
      Schema.makeFilter(
        (value: string) => /^#[0-9a-fA-F]{6}$/.test(value) || "Use a colour like #1F6FEB",
      ),
    ),
  ),
  category: Schema.optional(ManifestText(60)),
  examplePrompts: Schema.optional(Schema.Array(ManifestText(300)).check(Schema.isMaxLength(3))),
  mcpServers: Schema.Array(PluginManifestServer).check(Schema.isMaxLength(10)),
  skills: Schema.optional(Schema.Array(PluginManifestSkill).check(Schema.isMaxLength(20))),
}).check(
  Schema.makeFilter(
    (manifest) =>
      manifest.mcpServers.length + (manifest.skills?.length ?? 0) > 0 ||
      "List at least one MCP server or skill",
  ),
  Schema.makeFilter((manifest) => {
    const names = manifest.mcpServers.map((server) => server.name.toLowerCase());
    return new Set(names).size === names.length || "Give each MCP server its own name";
  }),
);
export interface PluginManifest extends Schema.Schema.Type<typeof PluginManifestStruct> {}
export const PluginManifest: Schema.Codec<PluginManifest> = PluginManifestStruct;

const formatIssuePath = (path: ReadonlyArray<PropertyKey>) =>
  path
    .map((key, index) =>
      typeof key === "number" ? `[${key}]` : index === 0 ? String(key) : `.${String(key)}`,
    )
    .join("");

/** Checks one manifest. Errors name each field that is wrong, one per line. */
export const decodePluginManifest = (
  input: unknown,
):
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly error: string } => {
  const result = Schema.decodeUnknownExit(PluginManifest)(input, { errors: "all" });
  if (Exit.isSuccess(result)) return { ok: true, manifest: result.value };
  const error = Cause.squash(result.cause);
  if (!Schema.isSchemaError(error)) return { ok: false, error: String(error) };
  const { issues } = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue);
  return {
    ok: false,
    error: issues
      .map((issue) => {
        const path = formatIssuePath(
          (issue.path ?? []).map((key) => (typeof key === "object" ? key.key : key)),
        );
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("\n"),
  };
};

/** A plugin manifest the user uploaded or pasted, as JSON text. */
const PluginImportInputFields = {
  manifest: Schema.String.check(Schema.isMaxLength(256_000)),
};
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginImportInputSchema extends Schema.Struct<typeof PluginImportInputFields> {}
export const PluginImportInput: PluginImportInputSchema = Schema.Struct(PluginImportInputFields);
export type PluginImportInput = typeof PluginImportInput.Type;

const PluginImportResultStruct = Schema.Struct({
  snapshot: PluginsSnapshot,
  pluginId: TrimmedNonEmptyString,
});
export interface PluginImportResult extends Schema.Schema.Type<typeof PluginImportResultStruct> {}
export const PluginImportResult: Schema.Codec<PluginImportResult> = PluginImportResultStruct;

const PluginMarketplaceInputFields = { url: TrimmedNonEmptyString };
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginMarketplaceInputSchema extends Schema.Struct<
  typeof PluginMarketplaceInputFields
> {}
export const PluginMarketplaceInput: PluginMarketplaceInputSchema = Schema.Struct(
  PluginMarketplaceInputFields,
);
export type PluginMarketplaceInput = typeof PluginMarketplaceInput.Type;

const PluginSourceInputFields = { sourceId: TrimmedNonEmptyString };
// Named so the RPC group's declaration refers to it instead of spelling it out.
export interface PluginSourceInputSchema extends Schema.Struct<typeof PluginSourceInputFields> {}
export const PluginSourceInput: PluginSourceInputSchema = Schema.Struct(PluginSourceInputFields);
export type PluginSourceInput = typeof PluginSourceInput.Type;

const PluginMarketplaceResultStruct = Schema.Struct({
  snapshot: PluginsSnapshot,
  sourceId: TrimmedNonEmptyString,
  /** How many plugins the marketplace lists that DJL could use. */
  added: Schema.Number,
  /** How many it left out because their manifest was not valid. */
  skipped: Schema.Number,
});
export interface PluginMarketplaceResult extends Schema.Schema.Type<
  typeof PluginMarketplaceResultStruct
> {}
export const PluginMarketplaceResult: Schema.Codec<PluginMarketplaceResult> =
  PluginMarketplaceResultStruct;

/** Mention path for a plugin from the DJL catalog (built-in plugins keep their own paths). */
export const DJL_PLUGIN_MENTION_PREFIX = "plugin://djl-plugin/";

/** The key an app is reached by on DJL's local gateway. */
export const pluginAppKey = (pluginId: string, appId: string) =>
  appId === pluginId ? pluginId : `${pluginId}_${appId}`;

/** The tool-server name an agent sees for that app. */
export const pluginServerName = (appKey: string) => `djl_${appKey.replace(/[^a-zA-Z0-9_]/g, "_")}`;

export const findPluginCatalogEntry = (
  snapshot: PluginsSnapshot,
  pluginId: string,
): PluginCatalogEntry | undefined => {
  for (const source of snapshot.sources) {
    const entry = source.plugins.find((plugin) => plugin.id === pluginId);
    if (entry) return entry;
  }
  return undefined;
};

export const isPluginInstalled = (snapshot: PluginsSnapshot, entry: PluginCatalogEntry): boolean =>
  entry.builtIn || snapshot.installed.some((installed) => installed.pluginId === entry.id);

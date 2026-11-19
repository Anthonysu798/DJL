import generated from "./generated.json";
export type AdapterKind = "dynamic" | "article" | "video" | "podcast";
export interface Adapter {
  id: string;
  kind: AdapterKind;
  platformKey: string;
  displayName: string;
  homeUrl: string;
  injectUrl: string;
  automaticSubmit: boolean;
  supportsNativeScheduling: boolean;
  sourcePath: string;
  source: string;
  deferred: number;
}
export const upstreamCommit = generated.commit;
export const adapterSources = generated.adapters as Adapter[];
export const adapters = adapterSources.map(
  ({ source: _source, deferred: _deferred, sourcePath: _sourcePath, ...metadata }) => ({
    ...metadata,
    identitySupported:
      Object.hasOwn(generated.accounts, metadata.platformKey) ||
      ["instagram", "linkedin", "threads", "youtube", "webhook"].includes(metadata.platformKey),
  }),
);
export const identitySources: Record<string, string> = generated.accounts;
export function getAdapter(id: string): Adapter {
  const adapter = adapterSources.find((item) => item.id === id);
  if (!adapter) throw new Error("Unknown MultiPost adapter");
  return adapter;
}

export const helperSource = generated.helperSource;

export { normalizeContent } from "./content";

export { webhookMessage } from "./webhook";

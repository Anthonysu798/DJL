import type {
  MultiPostBrowserRuntime,
  MultiPostScope,
  MultiPostAccount,
  MultiPostRuntimeContext,
  MultiPostEvidence,
  MultiPostIdentity,
  MultiPostNotice,
} from "@synara/contracts";
export class MultiPostHostClient implements MultiPostBrowserRuntime {
  constructor(
    private readonly endpoint = process.env.DJL_MULTIPOST_HOST_URL,
    private readonly token = process.env.DJL_MULTIPOST_HOST_TOKEN,
  ) {}
  private async call<T>(
    action: string,
    fields: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.endpoint || !this.token)
      throw new Error("Open DJL desktop to use MultiPost browser publishing");
    const url = new URL(this.endpoint);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
      throw new Error("Invalid private MultiPost host");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...fields }),
      signal: signal ?? AbortSignal.timeout(150_000),
    });
    const body = (await response.json()) as { result: T; error?: string };
    if (!response.ok) throw new Error(body.error ?? "MultiPost browser failed");
    return body.result;
  }
  async available() {
    if (!this.endpoint || !this.token) return false;
    try {
      return await this.call<boolean>("available", {}, AbortSignal.timeout(2000));
    } catch {
      return false;
    }
  }
  connect(scope: MultiPostScope, account: MultiPostAccount) {
    return this.call<void>("connect", { scope, account });
  }
  identity(scope: MultiPostScope, account: MultiPostAccount) {
    return this.call<MultiPostIdentity | null>("identity", { scope, account });
  }
  prepare(context: MultiPostRuntimeContext, signal?: AbortSignal) {
    return this.call<MultiPostEvidence>("prepare", { context }, signal);
  }
  submit(context: MultiPostRuntimeContext, signal?: AbortSignal) {
    return this.call<MultiPostEvidence>("submit", { context }, signal);
  }
  open(context: MultiPostRuntimeContext) {
    return this.call<void>("open", { context });
  }
  close(context: MultiPostRuntimeContext) {
    return this.call<void>("close", { context });
  }
  verify(context: MultiPostRuntimeContext) {
    return this.call<MultiPostEvidence>("verify", { context });
  }
  cancel(context: MultiPostRuntimeContext) {
    return this.call<MultiPostEvidence>("cancel", { context });
  }
  disconnect(scope: MultiPostScope, account: MultiPostAccount) {
    return this.call<void>("disconnect", { scope, account });
  }
  notify(notice: MultiPostNotice) {
    return this.call<void>("notify", { notice }, AbortSignal.timeout(3000));
  }
  postLink(context: MultiPostRuntimeContext) {
    return this.call<string | null>("postLink", { context }, AbortSignal.timeout(30_000));
  }
}

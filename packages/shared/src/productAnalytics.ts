import { parseAnalyticsBatch, parseAnalyticsInstallation, type AnalyticsEvent, type AnalyticsFeature, type AnalyticsInstallation } from "@synara/contracts/cloud";

export interface AnalyticsClientState {
  readonly enabled: boolean;
  readonly installationId: string;
  readonly credential: string | null;
  readonly apiBaseUrl: string | null;
  readonly appVersion: string;
  readonly scopeHash: string | null;
  readonly firstOpenReported: boolean;
  readonly events: readonly AnalyticsEvent[];
}
export interface AnalyticsClientContext {
  readonly apiBaseUrl: string;
  /** Local identity scope; never included in an analytics report. */
  readonly scope: string;
  readonly authorization?: string;
}
interface ClientDeps {
  readonly metadata: Omit<AnalyticsInstallation, "installationId">;
  readonly context: () => Promise<AnalyticsClientContext>;
  readonly storage: { readonly read: () => Promise<AnalyticsClientState | null>; readonly write: (state: AnalyticsClientState) => Promise<void> };
  readonly fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly now?: () => Date;
}

/** Small opt-in queue shared by desktop/web; content and identity stay out of the event body. */
export class ProductAnalyticsClient {
  private state: AnalyticsClientState;
  private started: Promise<void> | null = null;
  private foreground = false;
  private sessionId = crypto.randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sending: Promise<void> | null = null;
  private generation = 0;
  private pending: AbortController | null = null;
  private nextAttempt = 0;
  private contextSequence = 0;
  private persisting: Promise<void> = Promise.resolve();
  private closed = false;
  private metadataUpdated = false;

  constructor(private readonly deps: ClientDeps) {
    this.state = { enabled: false, installationId: crypto.randomUUID(), credential: null, apiBaseUrl: null,
      appVersion: deps.metadata.appVersion, scopeHash: null, firstOpenReported: false, events: [] };
  }
  private now() { return this.deps.now?.() ?? new Date(); }
  isEnabled(): boolean { return this.state.enabled; }

  start(): Promise<void> {
    this.started ??= (async () => {
      try {
        const saved = await this.deps.storage.read();
        if (!saved) return;
        parseAnalyticsInstallation({ ...this.deps.metadata, installationId: saved.installationId });
        const valid = saved.events.flatMap((event) => {
          try { return [...parseAnalyticsBatch({ events: [event] }).events]; } catch { return []; }
        });
        this.state = { ...saved, enabled: saved.enabled === true,
          credential: saved.credential && /^[A-Za-z0-9_-]{43}$/.test(saved.credential) ? saved.credential : null,
          events: saved.appVersion === this.deps.metadata.appVersion ? valid.slice(-100) : [], appVersion: this.deps.metadata.appVersion };
        this.trim();
        this.syncTimer();
      } catch { /* corrupt or unavailable local analytics state is ignored */ }
    })();
    return this.started;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.start();
    if (this.closed) return;
    this.generation++; this.pending?.abort();
    this.state = { ...this.state, enabled, events: enabled ? this.state.events : [] };
    this.nextAttempt = 0;
    await this.persist();
    this.syncTimer();
    if (enabled) {
      if (!this.state.firstOpenReported && !this.state.events.some((event) => event.kind === "first_open")) await this.enqueue("first_open");
      if (this.foreground) await this.enqueue("foreground");
      await this.flush();
    }
  }
  setForeground(value: boolean): void {
    if (this.closed) return;
    if (this.foreground === value) return;
    this.foreground = value;
    if (value) this.sessionId = crypto.randomUUID();
    this.syncTimer();
    if (this.state.enabled) void this.enqueue(value ? "foreground" : "session_end").then(() => this.flush());
  }
  private syncTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = !this.closed && this.foreground && this.state.enabled ? setInterval(() => {
      void this.enqueue("foreground").then(() => this.flush());
    }, 60_000) : null;
  }
  async recordFeature(feature: AnalyticsFeature): Promise<void> {
    await this.start();
    if (!this.state.enabled || !["cloud_chat", "local_task", "remote_control", "voice", "images"].includes(feature)) return;
    await this.enqueue("feature_used", feature);
    await this.flush();
  }
  private async enqueue(kind: AnalyticsEvent["kind"], feature?: AnalyticsFeature): Promise<void> {
    if (!this.state.enabled || this.closed) return;
    try { if (!await this.prepareContext()) return; } catch { return; }
    const fields = { eventId: crypto.randomUUID(), sessionId: this.sessionId, occurredAt: this.now().toISOString() };
    const event: AnalyticsEvent = kind === "feature_used" && feature ? { ...fields, kind, feature } : { ...fields, kind: kind as "foreground" | "first_open" | "session_end" };
    this.state = { ...this.state, events: [...this.state.events, event] };
    this.trim(); await this.persist();
  }
  private trim(): void {
    const oldest = this.now().getTime() - 7 * 86_400_000;
    const valid = this.state.events.filter((event) => { const time = Date.parse(event.occurredAt); return Number.isFinite(time) && time >= oldest && time <= this.now().getTime() + 300_000; });
    const firstOpen = !this.state.firstOpenReported ? valid.find((event) => event.kind === "first_open") : undefined;
    const recent = valid.slice(-100);
    this.state = { ...this.state, events: firstOpen && !recent.includes(firstOpen) ? [firstOpen, ...recent.slice(-99)] : recent };
  }
  private async persist(): Promise<void> {
    const snapshot = this.state;
    this.persisting = this.persisting.then(() => this.deps.storage.write(snapshot)).catch(() => undefined);
    await this.persisting;
  }
  flush(): Promise<void> {
    if (this.sending) return this.sending;
    const generation = this.generation;
    this.sending = this.send().catch(() => { if (generation === this.generation) this.nextAttempt = this.now().getTime() + 30_000; }).finally(() => { this.sending = null; });
    return this.sending;
  }
  private async prepareContext(): Promise<(AnalyticsClientContext & { origin: string }) | null> {
    const generation = this.generation;
    const sequence = ++this.contextSequence;
    const context = await this.deps.context();
    if (generation !== this.generation || !this.state.enabled || this.closed) return null;
    const base = new URL(context.apiBaseUrl);
    if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) || base.username || base.password || base.search || base.hash || base.pathname !== "/") return null;
    const scope = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(context.scope)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (sequence !== this.contextSequence) {
      const current = await this.deps.context();
      if (current.scope !== context.scope || new URL(current.apiBaseUrl).origin !== base.origin) return null;
    }
    if (generation !== this.generation || !this.state.enabled || this.closed) return null;
    if ((this.state.apiBaseUrl && this.state.apiBaseUrl !== base.origin) || (this.state.scopeHash && this.state.scopeHash !== scope)) {
      this.generation++; this.pending?.abort(); this.nextAttempt = 0;
    }
    if (this.state.apiBaseUrl && this.state.apiBaseUrl !== base.origin) {
      this.metadataUpdated = false;
      this.state = { ...this.state, installationId: crypto.randomUUID(), credential: null, firstOpenReported: false, events: [], scopeHash: scope };
    } else if (this.state.scopeHash && this.state.scopeHash !== scope) {
      this.state = { ...this.state, events: [] };
    }
    this.state = { ...this.state, apiBaseUrl: base.origin, scopeHash: scope };
    return { ...context, origin: base.origin };
  }
  private async send(): Promise<void> {
    await this.start();
    if (!this.state.enabled || this.closed) return;
    const context = await this.prepareContext();
    if (!context || this.now().getTime() < this.nextAttempt) return;
    const generation = this.generation;
    if (!this.state.firstOpenReported && !this.state.events.some((event) => event.kind === "first_open")) await this.enqueue("first_open");
    this.pending = new AbortController();
    const request = async (method: string, path: string, body: unknown) => {
      if (generation !== this.generation || !this.state.enabled) throw new Error("Analytics stopped");
      const response = await (this.deps.fetchImpl ?? fetch)(`${context.origin}/v1/analytics/${path}`, {
        method, headers: { "content-type": "application/json", ...(context.authorization ? { authorization: context.authorization } : {}), ...(this.state.credential ? { "x-djl-installation": this.state.credential } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.any([this.pending!.signal, AbortSignal.timeout(5000)]), redirect: "error",
      });
      if (response.status === 401) {
        const error = await response.clone().json().catch(() => null) as { error?: { code?: string } } | null;
        if (error?.error?.code === "installation_required" && generation === this.generation) {
          this.generation++; this.pending?.abort(); this.metadataUpdated = false;
          this.state = { ...this.state, installationId: crypto.randomUUID(), credential: null, firstOpenReported: false, events: [] };
          this.nextAttempt = this.now().getTime() + 30_000;
          await this.persist();
        }
      }
      return response;
    };
    const metadata = parseAnalyticsInstallation({ ...this.deps.metadata, installationId: this.state.installationId });
    if (!this.state.credential) {
      const response = await request("POST", "installations", metadata);
      if (!response.ok) throw new Error("Analytics unavailable");
      const result = await response.json() as { credential?: unknown; installationId?: unknown };
      if (result.installationId !== metadata.installationId || generation !== this.generation || typeof result.credential !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.credential)) return;
      this.state = { ...this.state, credential: result.credential }; await this.persist();
      this.metadataUpdated = true;
    } else if (!this.metadataUpdated) {
      const response = await request("PUT", "installation", metadata);
      if (!response.ok) throw new Error("Analytics unavailable");
      this.metadataUpdated = true;
    }
    this.trim(); await this.persist();
    for (let index = 0; index < 5 && this.state.events.length; index++) {
      const batch = this.state.events.slice(0, 20);
      const response = await request("POST", "events", { events: batch });
      if (!response.ok) throw new Error("Analytics unavailable");
      if (generation !== this.generation || !this.state.enabled) return;
      const sent = new Set(batch.map((event) => event.eventId));
      this.state = { ...this.state, events: this.state.events.filter((event) => !sent.has(event.eventId)),
        firstOpenReported: this.state.firstOpenReported || batch.some((event) => event.kind === "first_open") };
      await this.persist();
    }
    this.pending = null;
  }
  close(): void {
    this.closed = true;
    this.generation++; this.pending?.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

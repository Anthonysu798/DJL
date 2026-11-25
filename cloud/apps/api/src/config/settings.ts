/**
 * Typed reader over the admin-editable `settings` table.
 *
 * Every key the API reads is declared in SETTINGS with its default and a
 * parser; a missing or invalid stored value falls back to the default. The
 * whole table is cached per process for 30 seconds, so an admin edit takes
 * effect everywhere within that time.
 */
import { schema, type DjlDatabase } from "@djl/db";

interface SettingSpec<A> {
  readonly default: A;
  readonly parse: (raw: unknown) => A | undefined;
}

const int = (fallback: number, min: number): SettingSpec<number> => ({
  default: fallback,
  parse: (raw) =>
    typeof raw === "number" && Number.isInteger(raw) && raw >= min ? raw : undefined,
});

const perPlan = (fallback: number): SettingSpec<Readonly<Record<string, number>>> => ({
  default: { default: fallback },
  parse: (raw: unknown) =>
    typeof raw === "object" &&
    raw !== null &&
    Object.values(raw).every((v) => Number.isInteger(v) && (v as number) > 0)
      ? (raw as Readonly<Record<string, number>>)
      : undefined,
});

export const SETTINGS = {
  /** Sites per org, per plan id; plans not listed use `default`. */
  "sites.max_count": perPlan(3),
  /** Largest deploy zip per plan id, in bytes. */
  "sites.max_zip_bytes": perPlan(25 * 1024 * 1024),
  /** Most files in one deploy. */
  "sites.max_files": int(2000, 1),
  /** Deploys a user may start per hour. */
  "sites.deploys_per_hour": int(30, 1),
  /** Above this many in-flight streams per instance, low-priority plans are shed first. */
  "gateway.soft_cap_streams": int(150, 1),
  /** At this many in-flight streams per instance, only the top plan is admitted. */
  "gateway.hard_cap_streams": int(200, 1),
  /** Gateway requests allowed per client IP hash per minute. */
  "gateway.ip_requests_per_minute": int(300, 1),
  /** Most a single background task run may spend, in credits, unless the run sets its own cap. */
  "agent.run_credit_cap": int(200, 1),
  /** Total bytes of private files per org, per plan id; plans not listed use `default`. */
  "files.max_org_bytes": perPlan(2 * 1024 ** 3),
  /** Largest upload per plan id, in bytes; plans not listed use `default`. */
  "files.max_upload_bytes": {
    default: { default: 25 * 1024 * 1024 } as Readonly<Record<string, number>>,
    parse: (raw: unknown) =>
      typeof raw === "object" &&
      raw !== null &&
      Object.values(raw).every((v) => Number.isInteger(v) && (v as number) > 0)
        ? (raw as Readonly<Record<string, number>>)
        : undefined,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];

export class Settings {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private snapshot: { readonly at: number; readonly rows: Map<string, unknown> } | null = null;
  private loading: Promise<Map<string, unknown>> | null = null;

  constructor(
    private readonly db: DjlDatabase,
    options: { readonly ttlMs?: number; readonly now?: () => number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const rows = await this.rows();
    const spec: SettingSpec<SettingValue<K>> = SETTINGS[key];
    return spec.parse(rows.get(key)) ?? spec.default;
  }

  private async rows(): Promise<Map<string, unknown>> {
    const now = this.now();
    if (this.snapshot && now - this.snapshot.at < this.ttlMs) return this.snapshot.rows;
    this.loading ??= this.db
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .then((found) => {
        const rows = new Map(found.map((r) => [r.key, r.value]));
        this.snapshot = { at: now, rows };
        return rows;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }
}

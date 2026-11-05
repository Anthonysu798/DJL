import { sql } from "drizzle-orm";
import type { DjlDatabase } from "@djl/db";
import type { CommerceAlertIncident, CommerceAlertsResponse } from "@synara/contracts/cloud";
import { ApiError } from "../http/errors.ts";
import { CommerceAlertDeliveryService } from "./CommerceAlertDeliveryService.ts";

/** Follow-up windows, never contractual settlement deadlines or authorization to move funds. */
export const COMMERCE_ALERT_WINDOWS_SECONDS = {
  payment_unresolved: 900,
  payment_review: 300,
  refund_unresolved: 900,
  refund_review: 300,
  refund_pending: 86400,
  event_unprocessed: 300,
  event_review_unmapped: 300,
  external_refund_unresolved: 300,
  withdrawal_requested: 8 * 86400,
  withdrawal_approved: 48 * 3600,
} as const;

export interface CommerceAlertsOptions {
  readonly enabled?: boolean;
  readonly environment: string;
  readonly now?: () => Date;
  readonly emailDelivery?: Pick<CommerceAlertDeliveryService, "status">;
}
export interface CommerceAlertScanResult {
  readonly enabled: boolean;
  readonly skipped: boolean;
  readonly opened: number | null;
  readonly resolved: number | null;
  readonly pending: number | null;
  readonly open: number | null;
  readonly scannedAt: string | null;
}
export function commerceAlertsEnabled(value: unknown, environment: string): boolean {
  return (
    (value === "true" || value === "1") &&
    ["local", "test", "staging", "production"].includes(environment)
  );
}

// A complete, unpaged source snapshot. Retried callbacks do not reset an incident's observation clock.
function candidates() {
  return sql`
    select case when p.status='requires_review' then 'payment_review' else 'payment_unresolved' end kind,
      'payment_attempt' resource_type,p.id::text resource_id,p.order_id,p.status source_status,null::timestamptz eligible_at
    from commerce_payment_attempts p where p.status in ('creating','unknown','cancel_requested','requires_review')
    union all
    select case when r.status='requires_review' then 'refund_review' when r.status='pending' then 'refund_pending' else 'refund_unresolved' end,
      'provider_refund',r.id::text,r.order_id,r.status,null::timestamptz
    from commerce_provider_refunds r where r.status in ('submitting','unknown','pending','requires_review')
    union all
    select case when e.processed_at is null then 'event_unprocessed' else 'event_review_unmapped' end,
      'payment_event',e.id,
      coalesce((select p.order_id from commerce_payment_attempts p where p.session_id=e.object_id),
        (select r.order_id from commerce_provider_refunds r where r.provider_refund_id=e.object_id),
        (select x.order_id from commerce_external_refunds x where x.provider_refund_id=e.object_id)),
      case when e.processed_at is null then 'unprocessed' else 'requires_review' end,null::timestamptz
    from commerce_payment_events e where e.processed_at is null or
      (e.outcome='requires_review' and not exists(select 1 from commerce_payment_attempts p where p.session_id=e.object_id)
        and not exists(select 1 from commerce_provider_refunds r where r.provider_refund_id=e.object_id)
        and not exists(select 1 from commerce_external_refunds x where x.provider_refund_id=e.object_id))
    union all
    select 'external_refund_unresolved','external_refund',x.id::text,x.order_id,x.allocation_state||':'||x.provider_status,null::timestamptz
    from commerce_external_refunds x where x.allocation_state in ('unallocated','requires_review') or
      (x.allocation_state='allocated' and x.provider_status<>'succeeded')
    union all
    select case when w.status='requested' then 'withdrawal_requested' else 'withdrawal_approved' end,
      'withdrawal',w.id::text,null::uuid,w.status,
      case when w.status='requested' then w.created_at+interval '8 days'
        else coalesce(w.payment_started_at,w.updated_at)+interval '48 hours' end
    from commerce_withdrawals w where w.status in ('requested','approved','payment_pending','payment_unknown')
  `;
}
function count(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new ApiError(503, "commerce_alerts_unavailable", "Commerce monitoring is unavailable.");
  return Number(value);
}
type Cursor = { at: string; id: string };
function cursorValue(value: unknown): Cursor | null {
  if (value === undefined) return null;
  try {
    if (typeof value !== "string" || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error();
    const c = JSON.parse(Buffer.from(value, "base64url").toString()) as Cursor;
    if (
      typeof c.at === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(c.at) &&
      Number.isFinite(Date.parse(c.at)) &&
      new Date(c.at).getUTCFullYear() >= 1 &&
      new Date(c.at).toISOString().slice(0, 19) === c.at.slice(0, 19) &&
      typeof c.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id)
    )
      return c;
  } catch {
    /* Invalid cursors are client errors, never trusted SQL inputs. */
  }
  throw new ApiError(400, "bad_cursor", "Invalid commerce alert cursor.");
}

/** Database-only scanning and read-only email receipts; no notification is dispatched here. */
export class CommerceAlertsService {
  readonly enabled: boolean;
  private readonly emailDelivery: Pick<CommerceAlertDeliveryService, "status">;
  constructor(
    private readonly db: DjlDatabase,
    private readonly options: CommerceAlertsOptions,
  ) {
    this.enabled =
      options.enabled === true &&
      ["local", "test", "staging", "production"].includes(options.environment);
    this.emailDelivery =
      options.emailDelivery ??
      new CommerceAlertDeliveryService(db, {
        environment: options.environment,
        mode: ["local", "test"].includes(options.environment) ? "mock" : "resend",
      });
  }
  async scan(): Promise<CommerceAlertScanResult> {
    const skipped: CommerceAlertScanResult = {
      enabled: this.enabled,
      skipped: true,
      opened: null,
      resolved: null,
      pending: null,
      open: null,
      scannedAt: null,
    };
    if (!this.enabled) return skipped;
    try {
      return await this.db.transaction(
        async (tx) => {
          // Independent of financial writers; another scanner skips rather than overlapping a snapshot.
          const [lock] = await tx.execute<{ acquired: boolean }>(
            sql`select pg_try_advisory_xact_lock(17473,2) acquired`,
          );
          if (!lock?.acquired) return skipped;
          const [clock] = await tx.execute<{ at: string }>(
            sql`select to_char(coalesce(${this.options.now?.().toISOString() ?? null}::timestamptz,statement_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
          );
          const at = clock!.at;
          const traceId = `commerce-alerts:${crypto.randomUUID()}`;
          const [recovered] = await tx.execute<{ n: string }>(sql`
          with candidates as (${candidates()}), changed as (
            update commerce_alert_incidents a set state='resolved',resolved_at=${at}::timestamptz,last_transition_at=${at}::timestamptz
            where a.state in ('pending','open') and not exists(select 1 from candidates c where c.kind=a.kind and c.resource_id=a.resource_id)
            returning a.*
          ), logged as (
            insert into audit_events(actor_type,actor_id,action,target_type,target_id,after,trace_id,created_at)
            select 'system','worker:commerce-alerts','commerce.alert.resolved','commerce_alert',id::text,
              jsonb_build_object('kind',kind,'resourceType',resource_type,'resourceId',resource_id,'orderId',order_id),${traceId},${at}::timestamptz
            from changed where opened_at is not null returning id
          ) select count(*)::text n from logged
        `);
          await tx.execute(sql`
          with candidates as (${candidates()})
          insert into commerce_alert_incidents(kind,resource_type,resource_id,order_id,source_status,state,first_detected_at,last_seen_at,last_transition_at)
          select kind,resource_type,resource_id,order_id,source_status,'pending',${at}::timestamptz,${at}::timestamptz,${at}::timestamptz from candidates
          on conflict(kind,resource_id) where state in ('pending','open') do update
            set source_status=excluded.source_status,last_seen_at=excluded.last_seen_at
        `);
          const windows = sql.join(
            Object.entries(COMMERCE_ALERT_WINDOWS_SECONDS).map(
              ([kind, seconds]) => sql`when ${kind} then ${seconds}::integer`,
            ),
            sql` `,
          );
          const [opened] = await tx.execute<{ n: string }>(sql`
          with candidates as (${candidates()}), changed as (
            update commerce_alert_incidents a set state='open',opened_at=${at}::timestamptz,last_transition_at=${at}::timestamptz
            from candidates c where a.kind=c.kind and a.resource_id=c.resource_id and a.state='pending'
              and coalesce(c.eligible_at,a.first_detected_at+((case a.kind ${windows} end)*interval '1 second'))<=${at}::timestamptz
            returning a.*
          ), logged as (
            insert into audit_events(actor_type,actor_id,action,target_type,target_id,after,trace_id,created_at)
            select 'system','worker:commerce-alerts','commerce.alert.opened','commerce_alert',id::text,
              jsonb_build_object('kind',kind,'resourceType',resource_type,'resourceId',resource_id,'orderId',order_id,'sourceStatus',source_status),${traceId},${at}::timestamptz
            from changed returning id
          ) select count(*)::text n from logged
        `);
          const [totals] = await tx.execute<{ pending: string; open: string }>(
            sql`select count(*) filter(where state='pending')::text pending,count(*) filter(where state='open')::text open from commerce_alert_incidents`,
          );
          const result: CommerceAlertScanResult = {
            enabled: true,
            skipped: false,
            opened: count(opened!.n),
            resolved: count(recovered!.n),
            pending: count(totals!.pending),
            open: count(totals!.open),
            scannedAt: at,
          };
          await tx.execute(sql`insert into audit_events(actor_type,actor_id,action,target_type,target_id,after,trace_id,created_at) values
          ('system','worker:commerce-alerts','commerce.alert.scan_complete','commerce_alert_scan','singleton',${JSON.stringify(result)}::jsonb,${traceId},${at}::timestamptz)`);
          return result;
        },
        { isolationLevel: "repeatable read" },
      );
    } catch {
      // Do not report zero incidents or recover anything after a failed/partial scan.
      throw new ApiError(
        503,
        "commerce_alert_scan_failed",
        "Commerce monitoring scan failed; prior incidents remain unchanged.",
      );
    }
  }
  async list(
    query: { readonly status?: unknown; readonly cursor?: unknown } = {},
  ): Promise<CommerceAlertsResponse> {
    const status = query.status ?? "open";
    if (status !== "open" && status !== "resolved" && status !== "all")
      throw new ApiError(400, "bad_request", "Alert status must be open, resolved, or all.");
    const cursor = cursorValue(query.cursor);
    type Raw = {
      monitor: CommerceAlertsResponse["monitor"];
      open: string;
      pending: string;
      rows: Omit<CommerceAlertIncident, "emailDelivery">[];
    };
    const [row] = await this.db.execute<{ data: Raw }>(sql`
      with clock as (select coalesce(${this.options.now?.().toISOString() ?? null}::timestamptz,statement_timestamp()) at), last_scan as (
        select max(created_at) at from audit_events where actor_type='system' and actor_id='worker:commerce-alerts'
          and action='commerce.alert.scan_complete' and target_type='commerce_alert_scan' and target_id='singleton'
      ), page as (
        select * from commerce_alert_incidents a where opened_at is not null and (${status}='all' or a.state=${status})
          and (${cursor === null}::boolean or (a.last_transition_at,a.id)<(${cursor?.at ?? null}::timestamptz,${cursor?.id ?? null}::uuid))
        order by last_transition_at desc,id desc limit 101
      ) select jsonb_build_object(
        'monitor',jsonb_build_object('status',case when not ${this.enabled}::boolean then 'disabled' when s.at is null then 'never_scanned' when c.at-s.at>interval '900 seconds' then 'stale' else 'healthy' end,
          'lastSuccessfulScanAt',case when s.at is null then null else to_char(s.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'intervalSeconds',300,'staleAfterSeconds',900),
        'open',(select count(*)::text from commerce_alert_incidents where state='open'),'pending',(select count(*)::text from commerce_alert_incidents where state='pending'),
        'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'resourceType',resource_type,'resourceId',resource_id,'orderId',order_id,'sourceStatus',source_status,'state',state,
          'firstDetectedAt',to_char(first_detected_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'openedAt',to_char(opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'lastSeenAt',to_char(last_seen_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'resolvedAt',case when resolved_at is null then null else to_char(resolved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
          'lastTransitionAt',to_char(last_transition_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by last_transition_at desc,id desc) from page),'[]'::jsonb)
      ) data from clock c cross join last_scan s
    `);
    if (!row)
      throw new ApiError(503, "commerce_alerts_unavailable", "Commerce monitoring is unavailable.");
    const page = row.data.rows.slice(0, 100);
    const email = await this.emailDelivery.status(page.map((incident) => incident.id));
    const incidents = page.map((incident) =>
      Object.assign({}, incident, {
        emailDelivery: email.deliveries[incident.id] ?? null,
      }),
    );
    const last = incidents.at(-1);
    return {
      enabled: this.enabled,
      externalDelivery: email.summary,
      monitor: row.data.monitor,
      counts: { open: count(row.data.open), pending: count(row.data.pending) },
      incidents,
      nextCursor:
        row.data.rows.length > 100 && last
          ? Buffer.from(JSON.stringify({ at: last.lastTransitionAt, id: last.id })).toString(
              "base64url",
            )
          : null,
    };
  }
}

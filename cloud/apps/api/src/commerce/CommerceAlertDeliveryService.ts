import { sql } from "drizzle-orm";
import type { DjlDatabase } from "@djl/db";
import { MockOutbox, createResendSender, type EmailSender } from "@djl/notify";
import type {
  CommerceAlertEmailDelivery,
  CommerceAlertEmailSummary,
} from "@synara/contracts/cloud";
import { ApiError } from "../http/errors.ts";

type Tx = Parameters<Parameters<DjlDatabase["transaction"]>[0]>[0];
type State = CommerceAlertEmailDelivery["state"];
export interface CommerceAlertEmailOptions {
  readonly enabled?: boolean;
  readonly environment: string;
  readonly mode: "mock" | "resend";
  readonly to?: string;
  readonly from?: string;
  readonly senderConfigured?: boolean;
  readonly sender?: EmailSender;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly batchSize?: number;
}
const yes = (value: string | undefined) => value === "true" || value === "1";
const mailbox = (value: string | undefined) =>
  typeof value === "string" &&
  value === value.trim() &&
  value.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
    value,
  );
export function commerceAlertEmailConfig(values: NodeJS.ProcessEnv): CommerceAlertEmailOptions {
  const enabled = yes(values.DJL_COMMERCE_ALERT_EMAIL_ENABLED);
  const environment = values.DJL_ENV ?? "local";
  const mode =
    ["local", "test"].includes(environment) && values.DJL_MOCK_EXTERNALS !== "false"
      ? "mock"
      : "resend";
  return {
    enabled,
    mode,
    environment,
    ...(values.DJL_COMMERCE_ALERT_EMAIL_TO ? { to: values.DJL_COMMERCE_ALERT_EMAIL_TO } : {}),
    ...(values.DJL_COMMERCE_ALERT_EMAIL_FROM ? { from: values.DJL_COMMERCE_ALERT_EMAIL_FROM } : {}),
    senderConfigured:
      enabled &&
      (mode === "mock" || Boolean(values.DJL_COMMERCE_ALERT_EMAIL_RESEND_API_KEY?.trim())),
  };
}
function configuration(o: CommerceAlertEmailOptions): CommerceAlertEmailSummary["configuration"] {
  if (!o.enabled) return "disabled";
  return ["local", "test", "staging", "production"].includes(o.environment) &&
    mailbox(o.to) &&
    (o.mode === "mock" || mailbox(o.from)) &&
    (o.senderConfigured ?? Boolean(o.sender)) &&
    Number.isSafeInteger(o.timeoutMs ?? 15000) &&
    (o.timeoutMs ?? 15000) > 0 &&
    (o.timeoutMs ?? 15000) <= 30000 &&
    Number.isSafeInteger(o.batchSize ?? 20) &&
    (o.batchSize ?? 20) > 0 &&
    (o.batchSize ?? 20) <= 20
    ? "ready"
    : "unavailable";
}
/** Worker only. API status readers compose the config without constructing a sender. */
export function commerceAlertEmailSender(values: NodeJS.ProcessEnv): EmailSender | undefined {
  const o = commerceAlertEmailConfig(values);
  if (configuration(o) !== "ready") return undefined;
  try {
    return o.mode === "mock"
      ? new MockOutbox(false)
      : createResendSender({
          apiKey: values.DJL_COMMERCE_ALERT_EMAIL_RESEND_API_KEY!,
          from: o.from!,
          replyTo: o.from!,
        });
  } catch {
    // Bad optional delivery configuration must not stop unrelated AI worker jobs.
    return undefined;
  }
}
const unavailable = () =>
  new ApiError(
    503,
    "commerce_alert_email_unavailable",
    "Commerce email follow-up is unavailable; check its durable status before taking action.",
  );
const count = (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw unavailable();
  return n;
};
type Claim = {
  id: string;
  incidentId: string;
  recipient: string;
  token: string;
  kind: string;
  openedAt: string;
};

/** No financial writes. Unknown delivery is terminal and never automatically attempted again. */
export class CommerceAlertDeliveryService {
  readonly configuration: CommerceAlertEmailSummary["configuration"];
  constructor(
    private readonly db: DjlDatabase,
    private readonly options: CommerceAlertEmailOptions,
  ) {
    this.configuration = configuration(options);
  }
  private async clock(tx: Tx) {
    if (this.options.now) return this.options.now().toISOString();
    const [row] = await tx.execute<{ at: string }>(
      sql`select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
    );
    if (!row) throw unavailable();
    return row.at;
  }
  private async audit(tx: Tx, id: string, state: State, at: string) {
    await tx.execute(sql`insert into audit_events(actor_type,actor_id,action,target_type,target_id,after,created_at,trace_id)
      values('system','worker:commerce-alert-email','commerce.alert.email.state','commerce_alert_email',${id},
      ${JSON.stringify({ state, mode: this.options.mode })}::jsonb,${at}::timestamptz,${`commerce-alert-email:${id}`})`);
  }
  private async prepare() {
    await this.db.transaction(async (tx) => {
      const at = await this.clock(tx);
      const stale = await tx.execute<{ id: string }>(sql`with expired as (
        select id from commerce_alert_email_deliveries where mode=${this.options.mode} and state='submitting'
        and attempted_at<=${at}::timestamptz-interval '120 seconds' order by attempted_at,id limit 100 for update skip locked)
        update commerce_alert_email_deliveries d set state='needs_review',reason_code='delivery_interrupted',completed_at=${at}::timestamptz
        from expired e where d.id=e.id returning d.id`);
      for (const row of stale) await this.audit(tx, row.id, "needs_review", at);
      await tx.execute(sql`insert into commerce_alert_email_deliveries(incident_id,mode,recipient,created_at)
        select a.id,${this.options.mode},${this.options.to!},${at}::timestamptz from commerce_alert_incidents a
        where a.state='open' and a.opened_at is not null and not exists(select 1 from commerce_alert_email_deliveries d where d.incident_id=a.id and d.mode=${this.options.mode})
        order by a.opened_at,a.id limit 100 on conflict(incident_id,mode) do nothing`);
    });
  }
  private async claim(): Promise<Claim | "skipped_resolved" | "needs_review" | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.execute<{
        id: string;
        incidentId: string;
        recipient: string;
        incidentState: string;
        kind: string;
        openedAt: string;
      }>(sql`
        select d.id,d.incident_id as "incidentId",d.recipient,a.state as "incidentState",a.kind,
        to_char(a.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "openedAt"
        from commerce_alert_email_deliveries d join commerce_alert_incidents a on a.id=d.incident_id
        where d.state='pending' and d.mode=${this.options.mode} order by d.created_at,d.id limit 1 for update of d skip locked`);
      if (!row) return null;
      const at = await this.clock(tx);
      if (row.incidentState !== "open" || row.recipient !== this.options.to) {
        const state = row.incidentState !== "open" ? "skipped_resolved" : "needs_review";
        await tx.execute(
          sql`update commerce_alert_email_deliveries set state=${state},reason_code=${state === "skipped_resolved" ? "resolved_before_send" : "recipient_changed"},completed_at=${at}::timestamptz where id=${row.id}`,
        );
        await this.audit(tx, row.id, state, at);
        return state;
      }
      const token = crypto.randomUUID();
      await tx.execute(
        sql`update commerce_alert_email_deliveries set state='submitting',claim_token=${token},attempted_at=${at}::timestamptz where id=${row.id}`,
      );
      await this.audit(tx, row.id, "submitting", at);
      return { ...row, token };
    });
  }
  private async finish(
    claim: Claim,
    state: "accepted" | "simulated" | "needs_review",
    providerId: string | null,
  ): Promise<State> {
    return this.db.transaction(async (tx) => {
      const at = await this.clock(tx);
      const changed = await tx.execute<{
        id: string;
      }>(sql`update commerce_alert_email_deliveries set state=${state},provider_id=${providerId},reason_code=${state === "needs_review" ? "send_result_unknown" : null},completed_at=${at}::timestamptz
        where id=${claim.id} and state='submitting' and claim_token=${claim.token} returning id`);
      if (changed.length) {
        await this.audit(tx, claim.id, state, at);
        return state;
      }
      const [existing] = await tx.execute<{ state: State }>(
        sql`select state from commerce_alert_email_deliveries where id=${claim.id}`,
      );
      if (!existing) throw unavailable();
      return existing.state;
    });
  }
  async dispatch() {
    const result = {
      enabled: this.options.enabled === true,
      configuration: this.configuration,
      mode: this.options.mode,
      claimed: 0,
      accepted: 0,
      simulated: 0,
      needsReview: 0,
      skipped: 0,
    };
    if (this.configuration !== "ready") return result;
    if (!this.options.sender) return { ...result, configuration: "unavailable" as const };
    try {
      await this.prepare();
      for (let n = 0; n < (this.options.batchSize ?? 20); n++) {
        const claim = await this.claim();
        if (claim === null) break;
        if (claim === "skipped_resolved") {
          result.skipped++;
          continue;
        }
        if (claim === "needs_review") {
          result.needsReview++;
          continue;
        }
        result.claimed++;
        const text = `DJL commerce observed an incident requiring human review.\nKind: ${claim.kind}\nIncident: ${claim.incidentId}\nOpened: ${claim.openedAt}\nCheck the administrator incident queue. This notice does not authorize any payment, refund or withdrawal. The condition may have changed since observation.`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let terminal: State;
        try {
          const sent = await Promise.race([
            this.options.sender.send({
              to: claim.recipient,
              subject: "DJL commerce: manual review required",
              text,
              html: `<p>${text.replaceAll("\n", "<br>")}</p>`,
              tag: "commerce-alert",
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(unavailable()), this.options.timeoutMs ?? 15000);
            }),
          ]);
          if (
            typeof sent?.id !== "string" ||
            !sent.id.trim() ||
            sent.id.length > 200 ||
            Array.from(sent.id).some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            )
          )
            throw unavailable();
          terminal = await this.finish(
            claim,
            this.options.mode === "mock" ? "simulated" : "accepted",
            sent.id,
          );
        } catch {
          // Committed claim blocks retries even during DB outage. A later dispatch reaps it to needs_review.
          terminal = await this.finish(claim, "needs_review", null);
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (terminal === "accepted") result.accepted++;
        else if (terminal === "simulated") result.simulated++;
        else result.needsReview++;
      }
      return result;
    } catch {
      throw unavailable();
    }
  }
  /** One batch query; existing delivery history stays visible even when dispatch is disabled. */
  async status(incidentIds: readonly string[] = []): Promise<{
    summary: CommerceAlertEmailSummary;
    deliveries: Record<string, CommerceAlertEmailDelivery>;
  }> {
    if (
      incidentIds.length > 100 ||
      incidentIds.some(
        (id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
      )
    )
      throw unavailable();
    const [row] = await this.db.execute<{
      counts: Record<string, string>;
      last: string | null;
      deliveries: Record<string, CommerceAlertEmailDelivery>;
    }>(sql`
      with selected as (select distinct on(d.incident_id) d.* from commerce_alert_email_deliveries d
      where d.incident_id in(select value::uuid from jsonb_array_elements_text(${JSON.stringify(incidentIds)}::jsonb)) order by d.incident_id,(d.state='needs_review') desc,(d.mode='resend') desc,d.created_at desc,d.id desc)
      select jsonb_build_object('pending',count(*) filter(where state='pending')::text,'submitting',count(*) filter(where state='submitting')::text,
        'accepted',count(*) filter(where state='accepted')::text,'simulated',count(*) filter(where state='simulated')::text,
        'needsReview',count(*) filter(where state='needs_review')::text,'skipped',count(*) filter(where state='skipped_resolved')::text) counts,
        to_char(max(attempted_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') last,
        coalesce((select jsonb_object_agg(incident_id,jsonb_build_object('mode',mode,'state',state,
          'attemptedAt',case when attempted_at is null then null else to_char(attempted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
          'completedAt',case when completed_at is null then null else to_char(completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'reasonCode',reason_code)) from selected),'{}'::jsonb) deliveries from commerce_alert_email_deliveries`);
    if (!row) throw unavailable();
    return {
      summary: {
        enabled: this.options.enabled === true,
        configuration: this.configuration,
        mode: this.options.mode,
        counts: {
          pending: count(row.counts.pending!),
          submitting: count(row.counts.submitting!),
          accepted: count(row.counts.accepted!),
          simulated: count(row.counts.simulated!),
          needsReview: count(row.counts.needsReview!),
          skipped: count(row.counts.skipped!),
        },
        lastAttemptAt: row.last,
      },
      deliveries: row.deliveries,
    };
  }
}

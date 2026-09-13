/**
 * Observability: OpenTelemetry traces and metrics to an OTLP endpoint (Grafana
 * Cloud) and Sentry for errors. Both are no-ops unless configured, so local
 * development and tests run without them. Nothing here records prompt content.
 */
import { metrics, trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import * as Sentry from "@sentry/bun";

export interface ObservabilityOptions {
  readonly serviceName: string;
  readonly version: string;
  readonly environment: string;
  readonly otlpEndpoint: string | null;
  readonly otlpHeaders: string | null;
  readonly sentryDsn: string | null;
}

let sdk: NodeSDK | null = null;

function parseHeaders(raw: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const [k, ...v] = pair.split("=");
    if (k?.trim() && v.length) out[k.trim()] = v.join("=").trim();
  }
  return out;
}

export function startObservability(options: ObservabilityOptions): void {
  if (options.sentryDsn) {
    Sentry.init({
      dsn: options.sentryDsn,
      environment: options.environment,
      release: options.version,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend(event) {
        // Never ship request bodies or auth headers.
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
        }
        return event;
      },
    });
  }
  if (options.otlpEndpoint && !sdk) {
    const headers = parseHeaders(options.otlpHeaders);
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: options.serviceName,
        [ATTR_SERVICE_VERSION]: options.version,
        "deployment.environment": options.environment,
      }),
      traceExporter: new OTLPTraceExporter({ url: `${options.otlpEndpoint}/v1/traces`, headers }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${options.otlpEndpoint}/v1/metrics`, headers }),
        exportIntervalMillis: 30_000,
      }),
    });
    sdk.start();
  }
}

export async function stopObservability(): Promise<void> {
  await sdk?.shutdown().catch(() => undefined);
  sdk = null;
  await Sentry.flush(2000).catch(() => undefined);
}

const tracer = trace.getTracer("djl-api");
const meter = metrics.getMeter("djl-api");
export const gatewayInFlight = meter.createUpDownCounter("djl.gateway.in_flight", {
  description: "Streams currently open",
});
export const gatewayRequests = meter.createCounter("djl.gateway.requests", {
  description: "Gateway requests by outcome",
});
export const httpRequests = meter.createCounter("djl.http.requests", {
  description: "HTTP requests by route and status",
});
export const settledMicrocredits = meter.createCounter("djl.credits.settled_micro", {
  description: "Microcredits settled",
});

/** Run a function inside a span; errors are recorded and re-thrown. */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function captureError(error: unknown, context: Record<string, string>): void {
  Sentry.withScope((scope) => {
    scope.setTags(context);
    Sentry.captureException(error);
  });
}

export function currentTraceId(): string | null {
  return trace.getActiveSpan()?.spanContext().traceId ?? null;
}

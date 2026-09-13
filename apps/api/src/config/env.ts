/**
 * Process configuration. Read once at startup; every missing required value
 * in a non-local environment is a fatal error so a misconfigured deploy never
 * serves traffic.
 */
export type DjlEnv = "local" | "test" | "staging" | "production";

export interface ApiEnv {
  readonly env: DjlEnv;
  readonly port: number;
  readonly apiPublicUrl: string;
  readonly webPublicUrl: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly betterAuthSecret: string;
  readonly mockExternals: boolean;
  readonly trustedOrigins: readonly string[];
  /** Parent domain for the shared session cookie in staging/production, e.g. ".slcor.com". */
  readonly cookieDomain: string | null;
  readonly google: { readonly clientId: string; readonly clientSecret: string } | null;
  readonly apple: { readonly clientId: string; readonly clientSecret: string } | null;
}

function required(name: string, env: NodeJS.ProcessEnv, fallbackForLocal?: string): string {
  const value = env[name];
  if (value && value.length > 0) return value;
  const djlEnv = env.DJL_ENV ?? "local";
  if ((djlEnv === "local" || djlEnv === "test") && fallbackForLocal !== undefined) {
    return fallbackForLocal;
  }
  throw new Error(`Missing required environment variable ${name}`);
}

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const djlEnv = (env.DJL_ENV ?? "local") as DjlEnv;
  const isLocal = djlEnv === "local" || djlEnv === "test";
  const mockExternals = isLocal ? env.DJL_MOCK_EXTERNALS !== "false" : false;
  const secret = required("BETTER_AUTH_SECRET", env, "local-dev-secret-change-me-32-bytes-min");
  if (!isLocal && secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters outside local");
  }
  const apiPublicUrl = required("API_PUBLIC_URL", env, "http://localhost:8787");
  const webPublicUrl = required("WEB_PUBLIC_URL", env, "http://localhost:3000");
  const google =
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
      ? { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET }
      : null;
  const apple =
    env.APPLE_OAUTH_CLIENT_ID && env.APPLE_OAUTH_CLIENT_SECRET
      ? { clientId: env.APPLE_OAUTH_CLIENT_ID, clientSecret: env.APPLE_OAUTH_CLIENT_SECRET }
      : null;
  return {
    env: djlEnv,
    port: Number(env.API_PORT ?? 8787),
    apiPublicUrl,
    webPublicUrl,
    databaseUrl: required("DATABASE_URL", env, "postgres://djl:djl@localhost:54329/djl"),
    redisUrl: required("REDIS_URL", env, "redis://localhost:63799"),
    betterAuthSecret: secret,
    mockExternals,
    trustedOrigins: [webPublicUrl, "djl://app", ...(isLocal ? ["http://localhost:5173"] : [])],
    cookieDomain: env.COOKIE_DOMAIN?.trim() || null,
    google,
    apple,
  };
}

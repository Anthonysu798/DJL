/** Public runtime configuration. NEXT_PUBLIC_API_URL is https://api.slcor.com in production. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(
  /\/+$/,
  "",
);
export const AUTH_URL = `${API_URL}/v1/auth`;
export const SUPPORT_EMAIL = "support@slcor.com";

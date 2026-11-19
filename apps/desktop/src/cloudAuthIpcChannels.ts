// Shared with the sandboxed preload: no runtime schema or Node dependencies.
export const CLOUD_AUTH_CALLBACK_CHANNEL = "desktop:cloud-auth-callback";
export const CLOUD_AUTH_TAKE_CALLBACK_CHANNEL = "desktop:cloud-auth-take-callback";

export interface CloudAuthCallback {
  readonly code: string;
  readonly state: string;
}

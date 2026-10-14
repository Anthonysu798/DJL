import type { CloudRegisterDeviceResponse } from "@synara/contracts/cloud";
import { api } from "./api";

let registration: { sessionId: string; promise: Promise<CloudRegisterDeviceResponse> } | null =
  null;

/** An opaque browser-install id, not a hardware id or a browser fingerprint. */
export function registerBrowserDevice(sessionId: string): Promise<CloudRegisterDeviceResponse> {
  if (registration?.sessionId === sessionId) return registration.promise;
  let fingerprint: string;
  try {
    fingerprint = localStorage.getItem("djl-web-device-id") ?? crypto.randomUUID();
    localStorage.setItem("djl-web-device-id", fingerprint);
  } catch {
    fingerprint = crypto.randomUUID();
  }
  const promise = api<CloudRegisterDeviceResponse>("/v1/devices", {
    method: "POST",
    json: { kind: "web", fingerprint },
  }).catch((error) => {
    registration = null;
    throw error;
  });
  registration = { sessionId, promise };
  return promise;
}

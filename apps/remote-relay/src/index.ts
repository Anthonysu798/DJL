// FILE: index.ts
// Purpose: Cloudflare Worker and Durable Objects for DJL's metadata-only, blind WebSocket relay.

import { DurableObject } from "cloudflare:workers";

import { normalizeDeviceToken, sendGenericPush } from "./apns";
import {
  DEFAULT_MESSAGES_PER_WINDOW,
  MAX_RELAY_MESSAGE_BYTES,
  consumeMessageBudget,
  normalizePairingCode,
  parseRelayRoute,
  readRelayRole,
  relayMessageByteLength,
  resolveRelayRegistration,
  type MessageBudgetState,
  type RelayRegistration,
  type RelayRole,
  validateRegistration,
} from "./policy";
import { type TrustedResolveRequest, verifyTrustedResolveRequest } from "./registryAuth";
import { finalizeRelaySocketClose } from "./socketLifecycle";

interface Env {
  readonly SESSIONS: DurableObjectNamespace<DJLRelaySession>;
  readonly REGISTRY: DurableObjectNamespace<DJLRelayRegistry>;
  readonly RELAY_ADMIN_TOKEN?: string;
  readonly APNS_TEAM_ID?: string;
  readonly APNS_KEY_ID?: string;
  readonly APNS_BUNDLE_ID?: string;
  readonly APNS_PRIVATE_KEY?: string;
}

interface SocketAttachment {
  readonly role: RelayRole;
  readonly connectionId: string;
  readonly connectedAt: number;
  readonly messageBudget?: MessageBudgetState;
}

interface RegistryRecord {
  readonly registration: RelayRegistration;
  readonly online: boolean;
  readonly updatedAt: number;
  readonly usedNonces: ReadonlyArray<string>;
}

interface PairingCodeRecord {
  readonly macDeviceId: string;
  readonly sessionId: string;
  readonly expiresAt: number;
}

interface PushRegistration {
  readonly deviceToken: string;
  readonly alertsEnabled: boolean;
  readonly environment: "development" | "production";
  readonly updatedAt: number;
  readonly deliveredDedupeKeys: ReadonlyArray<string>;
}

const REGISTRY_NAME = "djl-relay-registry-v1";
const HOST_SECRET_HEADER = "x-djl-session-secret";
const MAX_JSON_BODY_BYTES = 16_384;
const CLOSE_REPLACED = 4001;
const CLOSE_SESSION_UNAVAILABLE = 4004;
const CLOSE_REVOKED = 4005;
const CLOSE_RATE_LIMITED = 4008;
const CLOSE_MESSAGE_TOO_LARGE = 4009;

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff",
} as const;

const jsonResponse = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: securityHeaders });

const errorResponse = (status: number, code: string, message: string): Response =>
  jsonResponse({ ok: false, code, error: message }, status);

const registryStub = (env: Env): DurableObjectStub<DJLRelayRegistry> =>
  env.REGISTRY.getByName(REGISTRY_NAME);

const copyRequest = <CfHostMetadata, Cf>(
  request: Request<CfHostMetadata, Cf>,
  url: string,
): Request =>
  new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "manual",
  });

const readBoundedJson = async <CfHostMetadata, Cf>(
  request: Request<CfHostMetadata, Cf>,
): Promise<Record<string, unknown> | null> => {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const authorizeAdmin = (request: Request, env: Env): boolean => {
  const configured = env.RELAY_ADMIN_TOKEN?.trim();
  const supplied = request.headers.get("authorization");
  return Boolean(configured && supplied === `Bearer ${configured}`);
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "djl-remote-relay" });
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/v1/trusted/session/resolve" ||
        url.pathname === "/v1/pairing/code/resolve")
    ) {
      return registryStub(env).fetch(copyRequest(request, `https://registry${url.pathname}`));
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/v1/push/session/register-device" ||
        url.pathname === "/v1/push/session/notify-completion")
    ) {
      const body = await readBoundedJson(request.clone());
      const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
      const route = parseRelayRoute(new URL(`https://relay.invalid/relay/${sessionId}`));
      if (!route) return errorResponse(400, "invalid_session", "The relay session is invalid.");
      const internalPath = url.pathname.endsWith("register-device")
        ? "/internal/push/register-device"
        : "/internal/push/notify-completion";
      return env.SESSIONS.getByName(route.sessionId).fetch(
        copyRequest(request, `https://session${internalPath}`),
      );
    }

    const revokeMatch = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9_-]{16,128})\/revoke$/);
    const revokeSessionId = revokeMatch?.[1];
    if (request.method === "POST" && revokeSessionId) {
      if (!authorizeAdmin(request, env)) {
        return errorResponse(401, "unauthorized", "A relay administrator token is required.");
      }
      return env.SESSIONS.getByName(revokeSessionId).fetch("https://session/internal/revoke", {
        method: "POST",
      });
    }

    const route = parseRelayRoute(url);
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket" && route) {
      return env.SESSIONS.getByName(route.sessionId).fetch(request);
    }

    return errorResponse(404, "not_found", "Route not found.");
  },
} satisfies ExportedHandler<Env>;

export class DJLRelaySession extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/internal/revoke") {
      await this.ctx.storage.put("revoked", true);
      for (const socket of this.ctx.getWebSockets()) {
        socket.close(CLOSE_REVOKED, "This DJL remote session was revoked");
      }
      await this.markRegistryOffline();
      return jsonResponse({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/internal/push/register-device") {
      return this.registerPushDevice(request);
    }
    if (request.method === "POST" && url.pathname === "/internal/push/notify-completion") {
      return this.notifyPushCompletion(request);
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return errorResponse(426, "upgrade_required", "A WebSocket upgrade is required.");
    }
    if (await this.ctx.storage.get<boolean>("revoked")) {
      return errorResponse(403, "session_revoked", "This DJL remote session was revoked.");
    }

    const route = parseRelayRoute(url);
    const role = readRelayRole(request);
    if (!route || !role) {
      return errorResponse(400, "invalid_connection", "The relay session or role is invalid.");
    }

    if (role === "mac") {
      const hostSecret = request.headers.get(HOST_SECRET_HEADER)?.trim() ?? "";
      if (!(await this.authorizeHost(hostSecret))) {
        return errorResponse(401, "invalid_host_secret", "The DJL host secret is invalid.");
      }
      const notificationSecret = request.headers.get("x-djl-notification-secret")?.trim() ?? "";
      if (!(await this.authorizeNotificationSecret(notificationSecret, true))) {
        return errorResponse(
          401,
          "invalid_notification_secret",
          "The DJL notification secret is invalid.",
        );
      }
      const registration = await this.registrationFromHeaders(request, route.sessionId);
      if (!registration) {
        return errorResponse(400, "invalid_registration", "The DJL host registration is invalid.");
      }
      const registered = await this.registerOnline(registration);
      if (!registered) {
        return errorResponse(503, "registry_unavailable", "The relay registry is unavailable.");
      }
    } else if (this.ctx.getWebSockets("role:mac").length === 0) {
      return errorResponse(409, "host_offline", "The paired computer is offline.");
    }

    for (const existing of this.ctx.getWebSockets(`role:${role}`)) {
      existing.close(CLOSE_REPLACED, `Replaced by a newer ${role} connection`);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: SocketAttachment = {
      role,
      connectionId: crypto.randomUUID(),
      connectedAt: Date.now(),
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`role:${role}`]);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) {
      socket.close(CLOSE_SESSION_UNAVAILABLE, "Missing relay connection state");
      return;
    }
    if (relayMessageByteLength(message) > MAX_RELAY_MESSAGE_BYTES) {
      socket.close(CLOSE_MESSAGE_TOO_LARGE, "Relay frame exceeds the size limit");
      return;
    }

    const budget = consumeMessageBudget(
      attachment.messageBudget,
      Date.now(),
      DEFAULT_MESSAGES_PER_WINDOW,
    );
    socket.serializeAttachment({ ...attachment, messageBudget: budget.state });
    if (!budget.allowed) {
      socket.close(CLOSE_RATE_LIMITED, "Relay message rate exceeded");
      return;
    }

    if (attachment.role === "mac" && typeof message === "string") {
      const registration = await this.registrationFromMessage(message);
      if (registration) {
        await this.registerOnline(registration);
        return;
      }
    }

    const peerRole: RelayRole = attachment.role === "mac" ? "iphone" : "mac";
    const peers = this.ctx.getWebSockets(`role:${peerRole}`);
    if (peers.length === 0) {
      if (attachment.role === "iphone") {
        socket.close(CLOSE_SESSION_UNAVAILABLE, "The paired computer is offline");
      }
      return;
    }
    for (const peer of peers) {
      if (peer.readyState === WebSocket.OPEN) peer.send(message);
    }
  }

  override async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    await finalizeRelaySocketClose(attachment?.role, () => this.markRegistryOffline());
  }

  override webSocketError(socket: WebSocket): void {
    socket.close(1011, "Relay WebSocket error");
  }

  private async authorizeHost(secret: string): Promise<boolean> {
    if (secret.length < 32 || secret.length > 256) return false;
    const incomingHash = await this.hashSecret(secret);
    const existingHash = await this.ctx.storage.get<string>("hostSecretHash");
    if (!existingHash) {
      await this.ctx.storage.put("hostSecretHash", incomingHash);
      return true;
    }
    if (existingHash.length !== incomingHash.length) return false;
    let difference = 0;
    for (let index = 0; index < existingHash.length; index += 1) {
      difference |= existingHash.charCodeAt(index) ^ incomingHash.charCodeAt(index);
    }
    return difference === 0;
  }

  private async authorizeNotificationSecret(secret: string, create: boolean): Promise<boolean> {
    if (secret.length < 32 || secret.length > 256) return false;
    const incomingHash = await this.hashSecret(secret);
    const existingHash = await this.ctx.storage.get<string>("notificationSecretHash");
    if (!existingHash) {
      if (!create) return false;
      await this.ctx.storage.put("notificationSecretHash", incomingHash);
      return true;
    }
    if (existingHash.length !== incomingHash.length) return false;
    let difference = 0;
    for (let index = 0; index < existingHash.length; index += 1) {
      difference |= existingHash.charCodeAt(index) ^ incomingHash.charCodeAt(index);
    }
    return difference === 0;
  }

  private async hashSecret(secret: string): Promise<string> {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    );
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  private async registrationFromHeaders(
    request: Request,
    sessionId: string,
  ): Promise<RelayRegistration | null> {
    const existing = await this.ctx.storage.get<RelayRegistration>("registration");
    return resolveRelayRegistration(
      {
        macDeviceId: request.headers.get("x-mac-device-id"),
        macIdentityPublicKey: request.headers.get("x-mac-identity-public-key"),
        displayName: request.headers.get("x-machine-name"),
        trustedPhoneDeviceId: request.headers.get("x-trusted-phone-device-id"),
        trustedPhonePublicKey: request.headers.get("x-trusted-phone-public-key"),
        pairingCode: request.headers.get("x-pairing-code"),
        pairingVersion: Number(request.headers.get("x-pairing-version")),
        pairingExpiresAt: Number(request.headers.get("x-pairing-expires-at")),
      },
      existing,
      Date.now(),
      sessionId,
    );
  }

  private async registrationFromMessage(message: string): Promise<RelayRegistration | null> {
    try {
      const parsed = JSON.parse(message) as { kind?: unknown; registration?: unknown };
      if (parsed.kind !== "relayMacRegistration") return null;
      const existing = await this.ctx.storage.get<RelayRegistration>("registration");
      return existing?.sessionId
        ? validateRegistration(parsed.registration, Date.now(), existing.sessionId)
        : null;
    } catch {
      return null;
    }
  }

  private async registerOnline(registration: RelayRegistration): Promise<boolean> {
    await this.ctx.storage.put("registration", registration);
    const response = await registryStub(this.env).fetch("https://registry/internal/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registration),
    });
    return response.ok;
  }

  private async markRegistryOffline(): Promise<void> {
    const registration = await this.ctx.storage.get<RelayRegistration>("registration");
    if (!registration) return;
    await registryStub(this.env).fetch("https://registry/internal/offline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        macDeviceId: registration.macDeviceId,
        sessionId: registration.sessionId,
      }),
    });
  }

  private async registerPushDevice(request: Request): Promise<Response> {
    const body = await readBoundedJson(request);
    const secret = typeof body?.notificationSecret === "string" ? body.notificationSecret : "";
    if (!(await this.authorizeNotificationSecret(secret, false))) {
      return errorResponse(
        401,
        "invalid_notification_secret",
        "The notification secret is invalid.",
      );
    }
    const deviceToken = normalizeDeviceToken(body?.deviceToken);
    const environment = body?.environment === "development" ? "development" : "production";
    if (!deviceToken)
      return errorResponse(400, "invalid_device_token", "The APNs token is invalid.");
    const existing = await this.ctx.storage.get<PushRegistration>("pushRegistration");
    const registration: PushRegistration = {
      deviceToken,
      alertsEnabled: body?.alertsEnabled !== false,
      environment,
      updatedAt: Date.now(),
      deliveredDedupeKeys: existing?.deliveredDedupeKeys ?? [],
    };
    await this.ctx.storage.put("pushRegistration", registration);
    return jsonResponse({ ok: true });
  }

  private async notifyPushCompletion(request: Request): Promise<Response> {
    const body = await readBoundedJson(request);
    const secret = typeof body?.notificationSecret === "string" ? body.notificationSecret : "";
    if (!(await this.authorizeNotificationSecret(secret, false))) {
      return errorResponse(
        401,
        "invalid_notification_secret",
        "The notification secret is invalid.",
      );
    }
    const registration = await this.ctx.storage.get<PushRegistration>("pushRegistration");
    if (!registration?.alertsEnabled) return jsonResponse({ ok: true, skipped: true });

    const threadId = this.boundedPushField(body?.threadId, 256);
    const turnId = this.boundedPushField(body?.turnId, 256);
    const dedupeKey = this.boundedPushField(body?.dedupeKey, 512);
    const completionResult =
      body?.result === "completed" || body?.result === "failed" ? body.result : null;
    if (!threadId || !dedupeKey || !completionResult) {
      return errorResponse(
        400,
        "invalid_notification",
        "Notification routing metadata is invalid.",
      );
    }
    if (registration.deliveredDedupeKeys.includes(dedupeKey)) {
      return jsonResponse({ ok: true, deduplicated: true });
    }

    const delivery = await sendGenericPush(this.env, {
      deviceToken: registration.deviceToken,
      environment: registration.environment,
      threadId,
      ...(turnId ? { turnId } : {}),
      result: completionResult,
    });
    if (!delivery.ok) {
      return errorResponse(502, "apns_delivery_failed", delivery.reason.slice(0, 512));
    }
    await this.ctx.storage.put("pushRegistration", {
      ...registration,
      deliveredDedupeKeys: [...registration.deliveredDedupeKeys.slice(-127), dedupeKey],
    } satisfies PushRegistration);
    return jsonResponse({ ok: true });
  }

  private boundedPushField(value: unknown, maximum: number): string {
    return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : "";
  }
}

export class DJLRelayRegistry extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST")
      return errorResponse(405, "method_not_allowed", "POST required.");

    if (url.pathname === "/internal/register") return this.register(request);
    if (url.pathname === "/internal/offline") return this.markOffline(request);
    if (url.pathname === "/v1/pairing/code/resolve") return this.resolvePairingCode(request);
    if (url.pathname === "/v1/trusted/session/resolve") return this.resolveTrustedSession(request);
    return errorResponse(404, "not_found", "Registry route not found.");
  }

  private async register(request: Request): Promise<Response> {
    const body = await readBoundedJson(request);
    const sessionId = String(body?.sessionId ?? "");
    const macDeviceId = String(body?.macDeviceId ?? "");
    const key = `mac:${macDeviceId}`;
    const previous = await this.ctx.storage.get<RegistryRecord>(key);
    const registration = body
      ? resolveRelayRegistration(body, previous?.registration, Date.now(), sessionId)
      : null;
    if (!registration?.sessionId) {
      return errorResponse(400, "invalid_registration", "The host registration is invalid.");
    }

    if (previous?.registration.pairingCode !== registration.pairingCode) {
      await this.ctx.storage.delete(`code:${previous?.registration.pairingCode ?? ""}`);
    }
    const record: RegistryRecord = {
      registration,
      online: true,
      updatedAt: Date.now(),
      usedNonces: previous?.usedNonces ?? [],
    };
    const codeRecord: PairingCodeRecord = {
      macDeviceId: registration.macDeviceId,
      sessionId: registration.sessionId,
      expiresAt: registration.pairingExpiresAt,
    };
    await this.ctx.storage.put({
      [key]: record,
      [`code:${registration.pairingCode}`]: codeRecord,
    });
    return jsonResponse({ ok: true });
  }

  private async markOffline(request: Request): Promise<Response> {
    const body = await readBoundedJson(request);
    const macDeviceId = typeof body?.macDeviceId === "string" ? body.macDeviceId : "";
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    const key = `mac:${macDeviceId}`;
    const current = await this.ctx.storage.get<RegistryRecord>(key);
    if (current?.registration.sessionId === sessionId) {
      await this.ctx.storage.put(key, { ...current, online: false, updatedAt: Date.now() });
    }
    return jsonResponse({ ok: true });
  }

  private async resolvePairingCode(request: Request): Promise<Response> {
    const body = await readBoundedJson(request);
    const code = normalizePairingCode(body?.code);
    if (!code) return errorResponse(400, "invalid_request", "The pairing code is invalid.");
    const codeRecord = await this.ctx.storage.get<PairingCodeRecord>(`code:${code}`);
    if (!codeRecord)
      return errorResponse(404, "pairing_code_unavailable", "The pairing code is unavailable.");
    if (Date.now() > codeRecord.expiresAt) {
      await this.ctx.storage.delete(`code:${code}`);
      return errorResponse(410, "pairing_code_expired", "The pairing code expired.");
    }
    const record = await this.ctx.storage.get<RegistryRecord>(`mac:${codeRecord.macDeviceId}`);
    if (!record?.online || record.registration.sessionId !== codeRecord.sessionId) {
      return errorResponse(409, "host_offline", "The paired computer is offline.");
    }
    const registration = record.registration;
    return jsonResponse({
      ok: true,
      v: registration.pairingVersion,
      sessionId: registration.sessionId,
      macDeviceId: registration.macDeviceId,
      macIdentityPublicKey: registration.macIdentityPublicKey,
      displayName: registration.displayName,
      expiresAt: registration.pairingExpiresAt,
    });
  }

  private async resolveTrustedSession(request: Request): Promise<Response> {
    const body = await readBoundedJson(request);
    if (!body) return errorResponse(400, "invalid_request", "The resolve request is invalid.");
    const resolveRequest = body as unknown as TrustedResolveRequest;
    const record = await this.ctx.storage.get<RegistryRecord>(`mac:${resolveRequest.macDeviceId}`);
    if (!record?.online || !record.registration.sessionId) {
      return errorResponse(404, "mac_offline", "The trusted computer is offline.");
    }
    const verification = await verifyTrustedResolveRequest({
      request: resolveRequest,
      registration: record.registration,
      nonceAlreadyUsed: record.usedNonces.includes(resolveRequest.nonce),
    });
    if (!verification.ok) {
      const status = verification.code === "resolve_request_expired" ? 401 : 403;
      return errorResponse(
        status,
        verification.code,
        "The trusted reconnect request was rejected.",
      );
    }

    const usedNonces = [...record.usedNonces.slice(-63), resolveRequest.nonce];
    await this.ctx.storage.put(`mac:${resolveRequest.macDeviceId}`, { ...record, usedNonces });
    const registration = record.registration;
    return jsonResponse({
      ok: true,
      macDeviceId: registration.macDeviceId,
      macIdentityPublicKey: registration.macIdentityPublicKey,
      displayName: registration.displayName,
      sessionId: registration.sessionId,
    });
  }
}

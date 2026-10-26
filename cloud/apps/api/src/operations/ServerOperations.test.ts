import { eq, inArray } from "drizzle-orm";
import { schema } from "@djl/db";
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { AdminPrincipal } from "../admin/AdminAuth.ts";
import { testDatabase } from "../testing/db.ts";
import { ServerOperations } from "./ServerOperations.ts";
import type { HostController } from "./ControllerClient.ts";

const database = testDatabase();
const p: AdminPrincipal = {
  adminId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  email: "operator@test.invalid",
  role: "admin",
  mfaVerified: true,
};
const auth = { verifyOperationCode: vi.fn(async () => 100) };
const send = vi.fn(async (path: string, body?: unknown) =>
  path === "/operations" ? { id: (body as { requestId: string }).requestId } : {},
);
const controller: HostController = { request: send as HostController["request"] };
const traffic = {
  snapshot: vi.fn(async () => ({ requests: 0, errors: 0, averageLatencyMs: 0, history: [] })),
};
const service = new ServerOperations(database.db, controller, auth, traffic);
const keys: string[] = [];
const operation = () => {
  const id = crypto.randomUUID();
  keys.push("operations.request." + id);
  return {
    requestId: id,
    action: "restart",
    target: "admin",
    confirmation: "RESTART ADMIN",
    reason: "Operator recovery",
    totp: "123456",
  };
};
beforeEach(async () => {
  await database.db
    .delete(schema.settings)
    .where(eq(schema.settings.key, "operations.mfa." + p.adminId));
  send.mockClear();
  auth.verifyOperationCode.mockClear();
  auth.verifyOperationCode.mockResolvedValue(100);
});
afterAll(async () => {
  await database.db
    .delete(schema.settings)
    .where(inArray(schema.settings.key, [...keys, "operations.mfa." + p.adminId]));
  await database.close();
});
describe("server operations authorization and audit", () => {
  it("requires explicit operator authorization when an allowlist is configured", async () => {
    const restricted = new ServerOperations(database.db, controller, auth, traffic, []);
    await expect(restricted.submit(p, operation())).rejects.toMatchObject({
      code: "operator_required",
    });
    expect(send).not.toHaveBeenCalled();
  });
  it("denies employees and unverified sessions before contacting the controller", async () => {
    await expect(service.overview({ ...p, role: "employee" }, "hour")).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.submit({ ...p, mfaVerified: false }, operation())).rejects.toMatchObject({
      status: 403,
    });
    expect(send).not.toHaveBeenCalled();
  });
  it("denies missing fresh verification, invalid service and injection", async () => {
    auth.verifyOperationCode.mockRejectedValueOnce(new Error("Bad verification"));
    await expect(service.submit(p, operation())).rejects.toThrow();
    await expect(
      service.submit(p, { ...operation(), target: "admin; reboot" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(service.logs(p, "../../etc/passwd")).rejects.toMatchObject({ status: 400 });
    expect(send).not.toHaveBeenCalled();
  });
  it("persists an audit intent, retries the same ID, and never stores the MFA code", async () => {
    const input = operation();
    await service.submit(p, input);
    await service.submit(p, input);
    expect(auth.verifyOperationCode).toHaveBeenCalledTimes(1);
    const row = await database.db.query.settings.findFirst({
      where: eq(schema.settings.key, "operations.request." + input.requestId),
    });
    expect(JSON.stringify(row?.value)).not.toContain("123456");
    const events = await database.db.query.auditEvents.findMany({
      where: eq(schema.auditEvents.actorId, p.adminId),
    });
    expect(events.filter((e) => JSON.stringify(e.after).includes(input.requestId))).toHaveLength(1);
    await expect(
      service.submit(p, { ...input, target: "api", confirmation: "RESTART API" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("consumes a successful code once even across distinct operations", async () => {
    await service.submit(p, operation());
    await expect(service.submit(p, operation())).rejects.toMatchObject({ code: "code_used" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps an authorized receipt when the controller is offline, allowing safe retry", async () => {
    const input = operation();
    send.mockRejectedValueOnce(new Error("Controller offline"));
    await expect(service.submit(p, input)).rejects.toThrow("Controller offline");
    await service.submit(p, input);
    expect(auth.verifyOperationCode).toHaveBeenCalledTimes(1);
  });
  it("expires undispatched authorizations instead of executing them later", async () => {
    const input = operation();
    send.mockRejectedValueOnce(new Error("Controller offline"));
    await expect(service.submit(p, input)).rejects.toThrow();
    const key = "operations.request." + input.requestId;
    const row = await database.db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
    await database.db
      .update(schema.settings)
      .set({ value: { ...(row!.value as object), authorizedAt: Date.now() - 301000 } })
      .where(eq(schema.settings.key, key));
    await expect(service.submit(p, input)).rejects.toMatchObject({ code: "authorization_expired" });
  });
});

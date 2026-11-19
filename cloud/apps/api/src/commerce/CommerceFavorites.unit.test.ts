import type { DjlDatabase } from "@djl/db";
import { expect, it, vi } from "vitest";

import { CommerceService, type CommerceActor } from "./CommerceService.ts";

it("rejects account rotation, missing identity, admin callers and invalid desired states before SQL", async () => {
  const transaction = vi.fn(() => {
    throw new Error("Unexpected database access");
  });
  const service = new CommerceService({ transaction } as unknown as DjlDatabase, {
    mode: "disabled",
    environment: "test",
  });
  const actor: CommerceActor = {
    id: "00000000-0000-4000-8000-000000000001",
    type: "user",
    traceId: "favorite-guards",
  };
  const id = "00000000-0000-4000-8000-000000000002";
  for (const expected of [undefined, "other-account"]) {
    await expect(service.setFavorite(actor, id, true, expected)).rejects.toMatchObject({
      status: 401,
      code: "commerce_account_changed",
    });
  }
  await expect(
    service.setFavorite({ ...actor, type: "admin" }, id, true, actor.id),
  ).rejects.toMatchObject({ status: 403 });
  await expect(service.setFavorite(actor, "bad-id", true, actor.id)).rejects.toMatchObject({
    status: 400,
  });
  for (const saved of [undefined, "false", 1, null]) {
    await expect(service.setFavorite(actor, id, saved, actor.id)).rejects.toMatchObject({
      status: 400,
    });
  }
  expect(transaction).not.toHaveBeenCalled();
});

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Stripe webhook verification in Bun", () => {
  it("accepts a real HMAC signature and rejects a changed payload", () => {
    const output = execFileSync(
      "bun",
      [
        "-e",
        `
      import { createHmac } from "node:crypto";
      import { createStripeGateway } from "./src/billing/StripeGateway.ts";
      const secret = "whsec_unit_test_only";
      const payload = JSON.stringify({ id: "evt_verified", object: "event", type: "invoice.paid", data: { object: { id: "in_test" } } });
      const t = Math.floor(Date.now() / 1000);
      const hash = createHmac("sha256", secret).update(t + "." + payload).digest("hex");
      const signature = "t=" + t + ",v1=" + hash;
      const gateway = createStripeGateway({ secretKey: "sk_test_unit_only", webhookSecret: secret });
      const event = await gateway.constructEvent(payload, signature);
      let tamperRejected = false;
      try { await gateway.constructEvent(payload.replace("in_test", "in_changed"), signature); }
      catch { tamperRejected = true; }
      console.log(JSON.stringify({ id: event.id, tamperRejected }));
    `,
      ],
      { cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 10_000 },
    );
    expect(JSON.parse(output)).toEqual({ id: "evt_verified", tamperRejected: true });
  });
});

import { createDatabase, schema } from "./index.ts";
import { eq } from "drizzle-orm";

const { db, close } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
try {
  for (const plan of ["starter", "business", "autopilot"] as const) {
    const monthly = process.env[`STRIPE_${plan.toUpperCase()}_PRICE_ID`];
    const annual = process.env[`STRIPE_${plan.toUpperCase()}_ANNUAL_PRICE_ID`];
    if (!monthly && !annual) continue;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.id, plan))
        .for("update");
      if (
        !row ||
        ((!monthly || row.stripeMonthlyPriceId === monthly) &&
          (!annual || row.stripeAnnualPriceId === annual))
      )
        return;
      const prices = {
        stripeMonthlyPriceId: monthly || row.stripeMonthlyPriceId,
        stripeAnnualPriceId: annual || row.stripeAnnualPriceId,
      };
      await tx.update(schema.plans).set(prices).where(eq(schema.plans.id, plan));
      await tx.insert(schema.auditEvents).values({
        actorId: "setup:vps",
        actorType: "system",
        action: "plan.configure_stripe_price",
        targetType: "plan",
        targetId: plan,
        before: {
          stripeMonthlyPriceId: row.stripeMonthlyPriceId,
          stripeAnnualPriceId: row.stripeAnnualPriceId,
        },
        after: prices,
        traceId: crypto.randomUUID(),
      });
    });
  }
} finally {
  await close();
}

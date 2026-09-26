/**
 * Idempotent seed: plan rows from the domain defaults, the three kill
 * switches, and baseline settings. Safe to run on every deploy; admin edits
 * to existing rows are preserved because plans upsert only when absent.
 */
import { DEFAULT_PLANS, TRIAL_DAILY_BUDGET_USD_CENTS } from "@djl/domain";
import { sql } from "drizzle-orm";

import { createDatabase } from "./client.ts";
import { killSwitches, plans, settings, toolPrices } from "./schema/index.ts";

export async function seed(databaseUrl: string): Promise<void> {
  const { db, close } = createDatabase(databaseUrl, { max: 1 });
  try {
    for (const plan of DEFAULT_PLANS) {
      await db
        .insert(plans)
        .values({
          id: plan.id,
          name: plan.name,
          monthlyPriceUsdCents: plan.monthlyPriceUsdCents,
          annualPriceUsdCents: plan.annualPriceUsdCents,
          includedMicrocredits: plan.includedCredits,
          concurrentStreams: plan.concurrentStreams,
          requestsPerMinute: plan.requestsPerMinute,
          priorityWeight: plan.priorityWeight,
          syncQuotaBytes: BigInt(plan.syncQuotaBytes),
          requiresOwner2fa: plan.requiresOwner2fa,
          window5hMicro: plan.window5h,
          windowWeekMicro: plan.windowWeek,
        })
        .onConflictDoNothing({ target: plans.id });
    }
    for (const name of ["gateway", "billing", "sync"] as const) {
      await db
        .insert(killSwitches)
        .values({ name, engaged: false })
        .onConflictDoNothing({ target: killSwitches.name });
    }
    await db
      .insert(settings)
      .values([
        { key: "trial.daily_budget_usd_cents", value: TRIAL_DAILY_BUDGET_USD_CENTS },
        { key: "trial.credits", value: 200 },
        { key: "trial.expiry_days", value: 14 },
        { key: "gateway.soft_cap_streams", value: 150 },
        { key: "gateway.hard_cap_streams", value: 200 },
        { key: "gateway.ip_requests_per_minute", value: 300 },
        { key: "pricing.margin", value: 0.4 },
        { key: "admin.ip_blocklist", value: [] },
        { key: "agent.run_credit_cap", value: 200 },
      ])
      .onConflictDoNothing({ target: settings.key });
    // Agent tool prices in microcredits (1 credit = 1,000,000; 1 USD = 100 credits), with margin.
    await db
      .insert(toolPrices)
      .values([
        { tool: "exa_search", unit: "call", microPerUnit: 850_000n },
        { tool: "exa_contents", unit: "call", microPerUnit: 170_000n },
        { tool: "sandbox_second", unit: "second", microPerUnit: 10_000n },
        // Surcharge per edit_image call on top of the image model's per-image price.
        { tool: "image_edit", unit: "call", microPerUnit: 0n },
      ])
      .onConflictDoNothing({ target: toolPrices.tool });
    await db.execute(sql`select 1`);
  } finally {
    await close();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  await seed(url);
  const { seedModels } = await import("./seedModels.ts");
  const models = await seedModels(url);
  console.log(`seed applied (${models} new models)`);
}

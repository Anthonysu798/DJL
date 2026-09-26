/** Picks the language for a user's emails and texts from their stored locale. */
import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { Locale } from "@djl/notify";

export function toNotifyLocale(value: string | null | undefined): Locale {
  return value?.toLowerCase().startsWith("zh") ? "zh-Hans" : "en";
}

/** Unknown recipients (an invite to a new address, say) get English. */
export function makeLocaleLookup(db: DjlDatabase) {
  return {
    byEmail: async (email: string): Promise<Locale> => {
      const row = await db.query.user.findFirst({
        where: eq(schema.user.email, email.toLowerCase()),
        columns: { locale: true },
      });
      return toNotifyLocale(row?.locale);
    },
    byPhone: async (phoneNumber: string): Promise<Locale> => {
      const row = await db.query.user.findFirst({
        where: eq(schema.user.phoneNumber, phoneNumber),
        columns: { locale: true },
      });
      return toNotifyLocale(row?.locale);
    },
  };
}

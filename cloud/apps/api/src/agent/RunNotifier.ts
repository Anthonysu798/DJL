/**
 * Tells the user a background task ended: an APNs push to each of their iOS
 * devices, or, when they have none, an email in their stored language. Pushes
 * are content-free (ids and the conversation deep link, CloudRunPushData).
 * Tokens APNs reports as dead are revoked.
 */
import { and, eq, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { taskFinished, type EmailSender, type PushSender } from "@djl/notify";
import { cloudConversationDeepLink, type CloudRunPushData } from "@synara/contracts/cloud";

import { toNotifyLocale } from "../auth/locale.ts";
import type { RunRow } from "../runs/wire.ts";

export interface RunNotifierDeps {
  readonly db: DjlDatabase;
  readonly push: PushSender;
  readonly email: EmailSender;
  readonly webPublicUrl: string;
}

export class RunNotifier {
  constructor(private readonly deps: RunNotifierDeps) {}

  /** Returns how the user was told, for logs and tests. */
  async runFinished(run: RunRow): Promise<"push" | "email" | "none"> {
    if (run.status !== "succeeded" && run.status !== "failed") return "none"; // cancelled: the user did it
    const { db } = this.deps;
    const ok = run.status === "succeeded";
    const data: typeof CloudRunPushData.Encoded = {
      source: "djl.cloudRun",
      runId: run.id,
      conversationId: run.conversationId,
      status: run.status,
      url: cloudConversationDeepLink(run.conversationId),
    };
    const tokens = await db
      .select()
      .from(schema.pushTokens)
      .where(and(eq(schema.pushTokens.userId, run.userId), isNull(schema.pushTokens.revokedAt)));
    let delivered = false;
    let live = tokens.length;
    for (const token of tokens) {
      const result = await this.deps.push.send({
        token: token.token,
        environment: token.environment === "sandbox" ? "sandbox" : "production",
        message: {
          title: ok ? "DJL task finished" : "DJL task stopped",
          body: "Open DJL to see the result.",
          data,
        },
      });
      if (result.ok) delivered = true;
      else if (result.unregistered) {
        live -= 1;
        await db
          .update(schema.pushTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.pushTokens.id, token.id));
      }
    }
    if (delivered) return "push";
    if (live > 0) return "none"; // a device exists; a transient APNs failure is not worth an email
    const user = await db.query.user.findFirst({
      columns: { email: true, locale: true },
      where: eq(schema.user.id, run.userId),
    });
    const conversation = await db.query.conversations.findFirst({
      columns: { title: true },
      where: eq(schema.conversations.id, run.conversationId),
    });
    if (!user) return "none";
    await this.deps.email.send(
      taskFinished(
        user.email,
        ok,
        conversation?.title ?? null,
        `${this.deps.webPublicUrl}/chat/${run.conversationId}`,
        toNotifyLocale(user.locale),
      ),
    );
    return "email";
  }
}

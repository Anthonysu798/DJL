import { it, assert } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { createCampaign } from "@djl/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { SOCIAL_TOOLS, executeSocialTool } from "./socialTools";
import { saveDocument } from "./store";

const bridges = vi.hoisted(() => ({ accounts: vi.fn(), publishing: vi.fn() }));
vi.mock("./socialBridge", () => ({ socialBridge: bridges.accounts }));
vi.mock("./publishingBridge", () => ({ publishingBridge: bridges.publishing }));

it.layer(SqlitePersistenceMemory)("Agent social tool authority", (it) => {
  it.effect("does not expose a confirmation tool or permit a foreign conversation", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        SOCIAL_TOOLS.map((tool) => tool.name),
        [
          "djl_social_status",
          "djl_prepare_social_publish",
          "djl_cancel_social_task",
          "djl_social_metrics",
        ],
      );
      const campaign = { ...createCampaign("Private campaign"), threadId: "owner-thread" };
      yield* saveDocument("campaign", campaign.id, campaign, null);
      const error = yield* executeSocialTool(
        {
          threadId: "other-thread",
          stateDir: "/tmp/djl-social-test",
          authorizedRoot: "/tmp",
          attachmentFiles: [],
        },
        "djl_social_status",
        { campaignId: campaign.id, threadId: "owner-thread", userId: "owner" },
      ).pipe(Effect.flip);
      assert.include(String(error), "another conversation");
    }),
  );
  it.effect(
    "reports Connect-card automatic continuation without starting OAuth or granting publication consent",
    () =>
      Effect.gen(function* () {
        bridges.accounts.mockReset();
        bridges.publishing.mockReset();
        bridges.accounts.mockReturnValue(
          Effect.succeed({ accounts: [], providers: [], attempts: [] }),
        );
        bridges.publishing.mockReturnValue(Effect.succeed({ drafts: [] }));
        const campaign = { ...createCampaign("Connect then continue"), threadId: "resume-thread" };
        yield* saveDocument("campaign", campaign.id, campaign, null);
        const result = yield* executeSocialTool(
          {
            threadId: "resume-thread",
            stateDir: "/tmp/djl-social-test",
            authorizedRoot: "/tmp",
            attachmentFiles: [],
          },
          "djl_social_status",
          { campaignId: campaign.id },
        );
        assert.property(result, "connectionGuidance");
        const guidance = String((result as { connectionGuidance: unknown }).connectionGuidance);
        assert.include(guidance, "Connect button");
        assert.include(guidance, "persists the waiting task");
        assert.include(guidance, "automatically resumes");
        assert.include(guidance, "does not start OAuth");
        assert.include(guidance, "never publishing consent");
        assert.include(SOCIAL_TOOLS[0]!.description, "automatically resumes");
        assert.deepStrictEqual(
          bridges.accounts.mock.calls.map((call) => call[1].action),
          ["state"],
        );
        assert.deepStrictEqual(
          bridges.publishing.mock.calls.map((call) => call[1].action),
          ["state"],
        );
        assert.propertyVal(result, "publishingRequiresUserConfirmation", true);
      }),
  );
});

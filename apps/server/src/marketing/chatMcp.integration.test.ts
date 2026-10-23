import { describe, it, expect } from "vitest";
import { Effect, ManagedRuntime } from "effect";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import JSZip from "jszip";
import { ThreadId, approveCampaign, type Campaign } from "@synara/contracts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite";
import { makeWorkMcpServerLive } from "../work/Layers/WorkMcpServer";
import { WorkMcpServer } from "../work/Services/WorkMcpServer";
import { executeMarketingTool } from "./chatTools";
import { readDocument, saveDocument } from "./store";
import { publishingKit } from "./kit";
describe("real chat tools and publication kit", () => {
  it("prepares through authenticated MCP, scopes campaigns, and exports only an approved snapshot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "djl-marketing-chat-"));
    const db = ManagedRuntime.make(SqlitePersistenceMemory);
    const runtime = ManagedRuntime.make(
      makeWorkMcpServerLive((scope, name, args) =>
        db.runPromise(executeMarketingTool({ ...scope, stateDir: root }, name, args)),
      ),
    );
    try {
      await writeFile(
        path.join(root, "photo.png"),
        await sharp({ create: { width: 12, height: 8, channels: 4, background: "#f0c08080" } })
          .png()
          .toBuffer(),
      );
      const mcp = await runtime.runPromise(Effect.service(WorkMcpServer));
      const registration = await runtime.runPromise(
        mcp.registerSession({ threadId: ThreadId.makeUnsafe("chat-a"), authorizedRoot: root }),
      );
      const rpc = async (method: string, params: unknown) => {
        const response = await fetch(registration.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${registration.bearerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        return response.json() as Promise<{
          result: {
            isError: boolean;
            tools: { name: string }[];
            structuredContent: { campaignId: string };
          };
        }>;
      };
      const listed = await rpc("tools/list", {});
      expect(
        listed.result.tools.some((t: { name: string }) => t.name === "djl_prepare_marketing"),
      ).toBe(true);
      const prepared = await rpc("tools/call", {
        name: "djl_prepare_marketing",
        arguments: {
          name: "Fixture campaign",
          platforms: ["instagram", "red"],
          captions: { instagram: "A room for your next stay", red: "下一段旅程，从这里开始" },
          mediaPaths: ["photo.png"],
          imageAdjustments: { exposure: 0.2 },
        },
      });
      expect(prepared.result.isError).toBe(false);
      const id = prepared.result.structuredContent.campaignId;
      await expect(db.runPromise(publishingKit(root, id, 2))).rejects.toThrow("approve");
      const record = await db.runPromise(readDocument("campaign", id));
      const campaign = record!.value as Campaign;
      expect(campaign.assetIds).toHaveLength(1);
      await db.runPromise(
        saveDocument("campaign", id, approveCampaign(campaign, campaign.revision), record!.version),
      );
      const zip = await JSZip.loadAsync(
        await db.runPromise(publishingKit(root, id, campaign.revision)),
      );
      expect(await zip.file("captions/red.txt")!.async("string")).toBe("下一段旅程，从这里开始");
      expect(Object.keys(zip.files).some((n) => n.endsWith(".png"))).toBe(true);
      const other = await db.runPromise(
        executeMarketingTool(
          { threadId: "chat-b", authorizedRoot: root, attachmentFiles: [], stateDir: root },
          "djl_marketing_status",
          {},
        ),
      );
      expect(other.campaigns).toEqual([]);
      const forbidden = await rpc("tools/call", { name: "publish_now", arguments: {} });
      expect(forbidden.result.isError).toBe(true);
    } finally {
      await runtime.dispose();
      await db.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});

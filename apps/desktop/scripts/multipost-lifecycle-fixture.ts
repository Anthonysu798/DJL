import { app, BrowserWindow, powerMonitor, session } from "electron";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Effect, ManagedRuntime } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { layer } from "../../server/src/persistence/NodeSqliteClient";
import { MultiPostService } from "../../server/src/multipost/service";
import { MultiPostMcpServer } from "../../server/src/multipost/mcp";
import { MultiPostHostClient } from "../../server/src/multipost/hostClient";
import { DesktopMultiPostRuntime } from "../src/multipost/runtime";
import { startMultiPostHost } from "../src/multipost/host";
import { MultiPostTray } from "../src/multipost/tray";
import { multipostPartition } from "../src/multipost/identity";
import { initializeDesktopI18n } from "../src/desktopI18n";
import { adapters } from "@djl/multipost";
import type {
  MultiPostAccount,
  MultiPostDraft,
  MultiPostJob,
  MultiPostState,
} from "@djl/contracts";

const [directory, portArgument, phase, icon] = process.argv.slice(2);
const port = Number(portArgument);
if (!directory || !phase || !icon || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid lifecycle fixture arguments");
const endpoint = `http://127.0.0.1:${port}/hook`;
app.setPath("userData", path.join(directory, "profile"));
app.setPath("sessionData", path.join(directory, "sessions"));
if (process.platform === "darwin") app.setActivationPolicy("accessory");
app.on("window-all-closed", () => {});
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});
const report: Record<string, unknown> = { phase, platform: process.platform };
const scope = {
  workspaceId: "native-lifecycle",
  threadId: "native-chat",
  authorizedRoot: directory,
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app
  .whenReady()
  .then(async () => {
    await initializeDesktopI18n("en", ["en"]);
    const db = ManagedRuntime.make(layer({ filename: path.join(directory, "state.sqlite") }));
    const sql = await db.runPromise(Effect.service(SqlClient.SqlClient));
    const runtime = new DesktopMultiPostRuntime();
    const main = new BrowserWindow({ show: true, webPreferences: { sandbox: true } });
    const tray = new MultiPostTray(icon, () => main.show());
    tray.attach(main, () => quitting);
    const submit = runtime.submit.bind(runtime);
    runtime.submit = async (...args) => {
      report.mainVisibleAtSubmit = main.isVisible();
      return submit(...args);
    };
    const host = await startMultiPostHost(runtime);
    const client = new MultiPostHostClient(host.url, host.token);
    const service = new MultiPostService(sql, client, adapters);
    await service.initialize();
    const mcp = new MultiPostMcpServer(service);
    const registration = await mcp.register(scope);
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(registration.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${registration.bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const result = (await response.json()) as {
        result?: { isError?: boolean; structuredContent?: unknown };
        error?: unknown;
      };
      assert.equal(response.status, 200);
      assert.ok(!result.error && !result.result?.isError, JSON.stringify(result));
      return result.result!.structuredContent;
    };
    try {
      await main.loadURL("about:blank");
      if (phase === "publish") {
        const account = (await service.command(
          scope,
          {
            action: "create-account",
            platformKey: "webhook",
            label: "Native localhost fixture",
            homeUrl: endpoint,
          },
          "ui",
        )) as MultiPostAccount;
        await service.command(scope, { action: "verify-account", accountId: account.id }, "ui");
        const create = async (title: string, dueAt: string) => {
          const draft = (await call("djl_multipost_draft", {
            draft: {
              kind: "dynamic",
              data: { title, content: "Synthetic localhost acceptance only" },
              targets: [{ accountId: account.id, adapterId: "DYNAMIC_WEBHOOK" }],
              publicationMode: "scheduled",
              scheduledAt: dueAt,
              timezone: "UTC",
            },
          })) as MultiPostDraft;
          await service.command(
            scope,
            { action: "approve-draft", draftId: draft.id, revision: draft.revision },
            "ui",
          );
          await call("djl_multipost_schedule", { draftId: draft.id, revision: draft.revision });
          return draft;
        };
        const first = await create(
          "Native hidden-window acceptance",
          new Date(Date.now() + 1500).toISOString(),
        );
        main.close();
        assert.equal(main.isDestroyed(), false);
        assert.equal(main.isVisible(), false);
        report.hiddenBeforeDeadline = true;
        let published: MultiPostJob | undefined;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          await service.runDue();
          const state = (await service.command(scope, { action: "state" }, "ui")) as MultiPostState;
          published = state.jobs.find((job) => job.draftId === first.id);
          if (published?.state === "published") break;
          await wait(30);
        }
        assert.ok(published);
        assert.equal(published.state, "published");
        assert.equal(report.mainVisibleAtSubmit, false);
        assert.equal(main.isVisible(), false);
        report.publishedWhileHidden = true;
        report.postUrl = published.evidence?.postUrl;
        await call("djl_multipost_submit", { draftId: first.id, revision: first.revision });
        await service.runDue();
        report.repeatSubmitReturnedSameJob = true;
        const ownerSession = session.fromPartition(
          multipostPartition(scope.workspaceId, account.id),
        );
        await ownerSession.cookies.set({
          url: "https://fixture.invalid",
          name: "fixture-only",
          value: "synthetic",
          expirationDate: Date.now() / 1000 + 3600,
        });
        await ownerSession.cookies.flushStore();
        const other = session.fromPartition(multipostPartition(scope.workspaceId, "other-profile"));
        assert.equal((await other.cookies.get({ name: "fixture-only" })).length, 0);
        assert.equal(
          (await session.defaultSession.cookies.get({ name: "fixture-only" })).length,
          0,
        );
        report.accountAndNormalBrowserIsolation = true;
        powerMonitor.emit("resume");
        const resumed = await runtime.prepare({
          scope,
          account,
          job: { ...published, dueAt: new Date(Date.now() - 1).toISOString() },
        });
        assert.equal(resumed.state, "missed");
        report.resumeSignalStopsMissedTask = true;
        report.physicalSystemSuspendTested = false;
        const missedDueAt = new Date(Date.now() + 1500).toISOString();
        const second = await create("Must not catch up after quit", missedDueAt);
        writeFileSync(
          path.join(directory, "resume.json"),
          JSON.stringify({ accountId: account.id, draftId: second.id, dueAt: missedDueAt }),
        );
        report.pendingAtQuit = second.id;
      } else {
        const saved = JSON.parse(readFileSync(path.join(directory, "resume.json"), "utf8"));
        const cookies = await session
          .fromPartition(multipostPartition(scope.workspaceId, saved.accountId))
          .cookies.get({ name: "fixture-only" });
        assert.equal(cookies[0]?.value, "synthetic");
        report.cookiePersistedAcrossProcesses = true;
        await service.runDue();
        const state = (await service.command(scope, { action: "state" }, "ui")) as MultiPostState;
        assert.equal(state.jobs.find((job) => job.draftId === saved.draftId)?.state, "missed");
        assert.equal(state.jobs.filter((job) => job.state === "published").length, 1);
        report.missedOnRestartWithoutResubmission = true;
      }
      report.passed = true;
    } catch (error) {
      report.passed = false;
      report.failure = error instanceof Error ? error.stack : String(error);
    } finally {
      await mcp.close();
      await host.close();
      runtime.dispose();
      await db.dispose();
      app.once("will-quit", () => {
        report.mainDestroyedOnExplicitQuit = main.isDestroyed();
        report.passed = report.passed === true && main.isDestroyed();
        writeFileSync(path.join(directory, `${phase}.json`), JSON.stringify(report, null, 2), {
          mode: 0o600,
        });
      });
      tray.dispose();
      app.quit();
    }
  })
  .catch((error) => {
    writeFileSync(
      path.join(directory, `${phase}.json`),
      JSON.stringify({ passed: false, failure: String(error) }),
    );
    app.exit(1);
  });

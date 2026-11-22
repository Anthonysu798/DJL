import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { Effect, ManagedRuntime } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { layerMemory } from "../persistence/NodeSqliteClient";
import { MultiPostService } from "./service";
import type {
  MultiPostAccount,
  MultiPostBrowserRuntime,
  MultiPostCapability,
  MultiPostDraft,
  MultiPostEvidence,
  MultiPostFile,
  MultiPostQuickPostResult,
  MultiPostScope,
  MultiPostState,
} from "@synara/contracts";

const scope: MultiPostScope = { workspaceId: "a", threadId: "chat-a", authorizedRoot: "/tmp" };
const adapter = (id: string, platformKey: string, kind: MultiPostCapability["kind"]) => ({
  id,
  platformKey,
  kind,
  displayName: platformKey,
  homeUrl: `https://${platformKey}.example`,
  injectUrl: `https://${platformKey}.example/new`,
  identitySupported: true,
});
const capabilities: MultiPostCapability[] = [
  adapter("DYNAMIC_X", "x", "dynamic"),
  adapter("VIDEO_X", "x", "video"),
  adapter("DYNAMIC_INSTAGRAM", "instagram", "dynamic"),
  adapter("VIDEO_TIKTOK", "tiktok", "video"),
];
const image: MultiPostFile = { name: "photo.png", url: "Media/photo", type: "image/png" };
const video: MultiPostFile = { name: "clip.mp4", url: "Media/clip", type: "video/mp4" };
const noPreparationHook = async () => {};
const resources: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) await r.dispose();
});

async function setup(platforms: string[] = ["x"]) {
  const db = ManagedRuntime.make(layerMemory());
  resources.push(db);
  const clock = { now: new Date("2026-11-05T12:00:00Z") };
  const sent: string[] = [];
  const notices: unknown[] = [];
  let beforePrepare = noPreparationHook;
  let signedInAs = "real-user";
  let submitted: (() => Promise<MultiPostEvidence>) | null = null;
  const links = { asked: [] as string[], found: null as string | null };
  const runtime: MultiPostBrowserRuntime = {
    available: async () => true,
    connect: async () => {},
    disconnect: async () => {},
    identity: async (_scope, account) =>
      signedInAs
        ? {
            provider: account.platformKey,
            accountId: signedInAs,
            username: `${account.platformKey}-tester`,
            verifiedAt: clock.now.toISOString(),
          }
        : null,
    notify: async (notice) => {
      notices.push(notice);
    },
    prepare: async () => {
      await beforePrepare();
      return { state: "prepared", observedAt: clock.now.toISOString() };
    },
    postLink: async ({ job }) => {
      links.asked.push(job.id);
      return links.found;
    },
    submit: async ({ job }) => {
      sent.push(job.adapterId);
      if (submitted) return submitted();
      return {
        state: "published",
        postUrl: "https://example.com/post/1",
        observedAt: clock.now.toISOString(),
      };
    },
    verify: async () => ({ state: "uncertain", observedAt: clock.now.toISOString() }),
    cancel: async () => ({ state: "uncertain", observedAt: clock.now.toISOString() }),
  };
  const sql = await db.runPromise(Effect.service(SqlClient.SqlClient));
  const service = new MultiPostService(sql, runtime, capabilities, () => clock.now);
  await service.initialize();
  const accounts: MultiPostAccount[] = [];
  for (const platformKey of platforms) {
    const created = (await service.command(
      scope,
      { action: "create-account", platformKey, label: platformKey },
      "ui",
    )) as MultiPostAccount;
    accounts.push(
      (await service.command(
        scope,
        { action: "verify-account", accountId: created.id },
        "ui",
      )) as MultiPostAccount,
    );
  }
  const state = async () =>
    (await service.command(scope, { action: "state" }, "ui")) as MultiPostState;
  const draft = async (accountId = accounts[0]!.id, adapterId = "DYNAMIC_X", content = "Hello") =>
    (await service.command(
      scope,
      {
        action: "save-draft",
        draft: {
          kind: "dynamic",
          data: { title: "Trip", content },
          targets: [{ accountId, adapterId }],
          publicationMode: "now",
          scheduledAt: null,
          timezone: "America/Toronto",
        },
      },
      "agent",
    )) as MultiPostDraft;
  const autopilot = (accountId = accounts[0]!.id, dailyLimit = 5) =>
    service.command(scope, { action: "set-autopilot", accountId, enabled: true, dailyLimit }, "ui");
  return {
    service,
    accounts,
    clock,
    sent,
    notices,
    sql,
    /** Moves the clock and lets the queue look again. */
    later: async (ms: number) => {
      clock.now = new Date(clock.now.getTime() + ms);
      await service.runDue();
    },
    state,
    draft,
    autopilot,
    onPrepare: (fn: () => Promise<void>) => {
      beforePrepare = fn;
    },
    signInAs: (id: string) => {
      signedInAs = id;
    },
    onSubmit: (fn: () => Promise<MultiPostEvidence>) => {
      submitted = fn;
    },
    links,
  };
}

describe("autopilot", () => {
  it("can only be switched on by the user, never by an agent", async () => {
    const c = await setup();
    await expect(
      c.service.command(
        scope,
        { action: "set-autopilot", accountId: c.accounts[0]!.id, enabled: true },
        "agent",
      ),
    ).rejects.toThrow(/user/i);
    expect((await c.state()).accounts[0]!.autopilot ?? null).toBeNull();
  });

  it("requires a signed-in, verified account", async () => {
    const c = await setup();
    const fresh = (await c.service.command(
      scope,
      { action: "create-account", platformKey: "x", label: "Brand" },
      "ui",
    )) as MultiPostAccount;
    await expect(
      c.service.command(
        scope,
        { action: "set-autopilot", accountId: fresh.id, enabled: true },
        "ui",
      ),
    ).rejects.toThrow(/sign in/i);
  });

  it("defaults to five posts a day for thirty days", async () => {
    const c = await setup();
    const account = (await c.service.command(
      scope,
      { action: "set-autopilot", accountId: c.accounts[0]!.id, enabled: true },
      "ui",
    )) as MultiPostAccount;
    expect(account.autopilot).toMatchObject({
      dailyLimit: 5,
      expiresAt: "2026-12-05T12:00:00.000Z",
    });
  });

  it("lets the agent publish an unreviewed draft once the user switched it on", async () => {
    const c = await setup();
    const draft = await c.draft();
    await expect(
      c.service.command(scope, { action: "submit-draft", draftId: draft.id, revision: 1 }, "agent"),
    ).rejects.toThrow(/autopilot/i);
    await c.autopilot();
    await c.service.command(
      scope,
      { action: "submit-draft", draftId: draft.id, revision: 1 },
      "agent",
    );
    await c.later(10_000);
    const job = (await c.state()).jobs[0]!;
    expect(c.sent).toEqual(["DYNAMIC_X"]);
    expect(job).toMatchObject({ state: "published", autopilot: true });
  });

  it("does not cover an account that still has it switched off", async () => {
    const c = await setup(["x", "instagram"]);
    await c.autopilot(c.accounts[0]!.id);
    const draft = (await c.service.command(
      scope,
      {
        action: "save-draft",
        draft: {
          kind: "dynamic",
          data: { title: "Trip", content: "Hello" },
          targets: [
            { accountId: c.accounts[0]!.id, adapterId: "DYNAMIC_X" },
            { accountId: c.accounts[1]!.id, adapterId: "DYNAMIC_INSTAGRAM" },
          ],
          publicationMode: "now",
          scheduledAt: null,
          timezone: "America/Toronto",
        },
      },
      "agent",
    )) as MultiPostDraft;
    await expect(
      c.service.command(scope, { action: "submit-draft", draftId: draft.id, revision: 1 }, "agent"),
    ).rejects.toThrow(/autopilot.*instagram/i);
    expect((await c.state()).jobs).toHaveLength(0);
  });

  it("stops at the daily limit", async () => {
    const c = await setup();
    await c.autopilot(c.accounts[0]!.id, 1);
    for (const content of ["First", "Second"]) {
      const draft = await c.draft(c.accounts[0]!.id, "DYNAMIC_X", content);
      await c.service.command(
        scope,
        { action: "submit-draft", draftId: draft.id, revision: 1 },
        "agent",
      );
      await c.later(10_000);
    }
    const jobs = (await c.state()).jobs;
    expect(c.sent).toHaveLength(1);
    expect(jobs.find((job) => job.snapshot.data.content === "Second")).toMatchObject({
      state: "failed",
      error: expect.stringMatching(/daily/i),
    });
  });

  it("expires on its own", async () => {
    const c = await setup();
    await c.autopilot();
    const draft = await c.draft();
    c.clock.now = new Date("2026-12-06T12:00:00Z");
    await expect(
      c.service.command(scope, { action: "submit-draft", draftId: draft.id, revision: 1 }, "agent"),
    ).rejects.toThrow(/autopilot/i);
  });

  it("switching it off while a post is being prepared stops the post", async () => {
    const c = await setup();
    await c.autopilot();
    const draft = await c.draft();
    await c.service.command(
      scope,
      { action: "submit-draft", draftId: draft.id, revision: 1 },
      "agent",
    );
    c.onPrepare(async () => {
      await c.service.command(
        scope,
        { action: "set-autopilot", accountId: c.accounts[0]!.id, enabled: false },
        "ui",
      );
    });
    await c.later(10_000);
    expect(c.sent).toHaveLength(0);
    expect((await c.state()).jobs[0]!.state).toBe("cancelled");
  });

  it("switches off when the account is removed or a different person signs in", async () => {
    const c = await setup(["x", "instagram"]);
    await c.autopilot(c.accounts[0]!.id);
    await c.autopilot(c.accounts[1]!.id);
    await c.service.command(
      scope,
      { action: "disconnect-account", accountId: c.accounts[0]!.id },
      "ui",
    );
    c.signInAs("someone-else");
    await c.service.command(
      scope,
      { action: "verify-account", accountId: c.accounts[1]!.id },
      "ui",
    );
    const accounts = (await c.state()).accounts;
    expect(accounts.map((account) => account.autopilot ?? null)).toEqual([null, null]);
  });
});

describe("one-step posting", () => {
  const post = (c: Awaited<ReturnType<typeof setup>>, input: object, actor: "ui" | "agent") =>
    c.service.command(
      scope,
      { action: "quick-post", post: { text: "Hello world", ...input } },
      actor,
    ) as Promise<MultiPostQuickPostResult>;

  it("publishes straight away when the user presses Post", async () => {
    const c = await setup();
    const result = await post(c, { media: [image] }, "ui");
    expect(result).toMatchObject({ posted: true, needsApproval: false });
    expect(result.drafts[0]).toMatchObject({
      kind: "dynamic",
      data: { content: "Hello world", images: [image] },
      targets: [{ accountId: c.accounts[0]!.id, adapterId: "DYNAMIC_X" }],
    });
    await c.later(10_000);
    expect((await c.state()).jobs[0]!.state).toBe("published");
  });

  it("saves the agent's post for a tap when autopilot is off, and says so", async () => {
    const c = await setup();
    const result = await post(c, {}, "agent");
    expect(result).toMatchObject({ posted: false, needsApproval: true, jobs: [] });
    expect(result.message).toMatch(/tap post/i);
    await c.later(10_000);
    expect(c.sent).toHaveLength(0);
  });

  it("posts the agent's request without a tap when autopilot is on", async () => {
    const c = await setup();
    await c.autopilot();
    const result = await post(c, {}, "agent");
    expect(result).toMatchObject({ posted: true, needsApproval: false });
    await c.later(10_000);
    expect(c.sent).toEqual(["DYNAMIC_X"]);
  });

  it("posts to every signed-in account when none are named", async () => {
    const c = await setup(["x", "instagram"]);
    const result = await post(c, { media: [image] }, "ui");
    expect(result.drafts[0]!.targets.map((target) => target.adapterId)).toEqual([
      "DYNAMIC_X",
      "DYNAMIC_INSTAGRAM",
    ]);
  });

  it("sends one video as a video post or a regular post, whichever each platform takes", async () => {
    const c = await setup(["instagram", "tiktok", "x"]);
    const result = await post(c, { media: [video], title: "Launch day" }, "ui");
    const byKind = Object.fromEntries(result.drafts.map((draft) => [draft.kind, draft]));
    expect(byKind.video).toMatchObject({
      data: { title: "Launch day", content: "Hello world", video },
    });
    expect(byKind.video!.targets.map((target) => target.adapterId)).toEqual([
      "VIDEO_TIKTOK",
      "VIDEO_X",
    ]);
    expect(byKind.dynamic).toMatchObject({ data: { videos: [video] } });
    expect(byKind.dynamic!.targets.map((target) => target.adapterId)).toEqual([
      "DYNAMIC_INSTAGRAM",
    ]);
    expect(result.jobs).toHaveLength(3);
  });

  it("skips an account that cannot take the post and explains why", async () => {
    const c = await setup(["x", "tiktok", "instagram"]);
    const result = await post(c, {}, "ui");
    expect(result.drafts).toHaveLength(1);
    expect(result.skipped).toEqual([
      { accountId: c.accounts[1]!.id, label: "@tiktok-tester", reason: "needs-video" },
      { accountId: c.accounts[2]!.id, label: "@instagram-tester", reason: "needs-media" },
    ]);
    expect(result.message).toMatch(/tiktok.*video/i);
  });

  it("refuses when no chosen account can take the post", async () => {
    const c = await setup(["tiktok"]);
    await expect(post(c, {}, "ui")).rejects.toThrow(/video/i);
  });

  it("asks the user to connect an account when none is signed in", async () => {
    const c = await setup([]);
    await expect(post(c, {}, "agent")).rejects.toThrow(/connect/i);
  });

  it("needs something to post", async () => {
    const c = await setup();
    await expect(post(c, { text: "  " }, "ui")).rejects.toThrow(/write|add/i);
  });

  it("says a regular post's words exactly once, with no invented title", async () => {
    const c = await setup();
    const result = await post(c, { text: "Big news today\nMore below" }, "ui");
    expect(result.drafts[0]!.data).toMatchObject({
      title: "",
      content: "Big news today\nMore below",
    });
  });

  it("splits a video caption into its title and the rest", async () => {
    const c = await setup(["tiktok"]);
    const result = await post(c, { text: "Big news today\nMore below", media: [video] }, "ui");
    expect(result.drafts[0]!.data).toMatchObject({
      title: "Big news today",
      content: "More below",
    });
  });

  it("schedules for later instead of posting now", async () => {
    const c = await setup();
    const result = await post(c, { scheduledAt: "2026-11-06T09:00:00-05:00" }, "ui");
    expect(result.drafts[0]).toMatchObject({
      publicationMode: "scheduled",
      scheduledAt: "2026-11-06T14:00:00.000Z",
    });
    expect(result.jobs[0]).toMatchObject({ state: "queued", dueAt: "2026-11-06T14:00:00.000Z" });
    await c.later(10_000);
    expect(c.sent).toHaveLength(0);
  });

  it("imports a file from the workspace when the agent passes its path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "multipost-quick-"));
    await writeFile(path.join(root, "made-by-agent.png"), "png-bytes");
    const c = await setup();
    const result = (await c.service.command(
      { ...scope, authorizedRoot: root, mediaRoot: path.join(root, ".media") },
      { action: "quick-post", post: { text: "Fresh image", media: ["made-by-agent.png"] } },
      "ui",
    )) as MultiPostQuickPostResult;
    expect(result.drafts[0]!.data.images).toEqual([
      expect.objectContaining({
        name: "made-by-agent.png",
        type: "image/png",
        url: expect.stringMatching(/^Media\//),
      }),
    ]);
  });

  it("crops photos for a platform that would crop them itself, around the chosen point", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "multipost-crop-"));
    const wide = await sharp({
      create: { width: 300, height: 100, channels: 3, background: "#00ff00" },
    })
      .jpeg()
      .toBuffer();
    await writeFile(path.join(root, "wide.jpg"), wide);
    const c = await setup(["x", "instagram"]);
    const local = { ...scope, authorizedRoot: root, mediaRoot: path.join(root, ".media") };
    const [file] = (await c.service.command(
      local,
      { action: "import-media", paths: ["wide.jpg"] },
      "ui",
    )) as MultiPostFile[];
    const result = (await c.service.command(
      local,
      {
        action: "quick-post",
        post: { text: "Look", media: [{ ...file!, focus: { x: 1, y: 0.5 } }] },
      },
      "ui",
    )) as MultiPostQuickPostResult;
    const [draft] = result.drafts;
    const target = (platform: string) =>
      draft!.targets.find(
        (x) => x.accountId === c.accounts.find((a) => a.platformKey === platform)!.id,
      )!;
    expect(target("x").overrides).toBeUndefined();
    const [cropped] = target("instagram").overrides!.images!;
    expect(cropped).toMatchObject({ name: "wide.jpg", type: "image/jpeg" });
    const meta = await sharp(path.join(root, ".media", cropped!.url.slice(6))).metadata();
    expect([meta.width, meta.height]).toEqual([100, 100]);
    expect(
      result.jobs.find((job) => job.target.accountId === target("instagram").accountId)!.target,
    ).toMatchObject({ overrides: { images: [cropped] } });
  });
});

describe("made for people who are not technical", () => {
  const post = (
    c: Awaited<ReturnType<typeof setup>>,
    actor: "ui" | "agent",
    scheduledAt?: string,
  ) =>
    c.service.command(
      scope,
      { action: "quick-post", post: { text: "Hello", ...(scheduledAt ? { scheduledAt } : {}) } },
      actor,
    ) as Promise<MultiPostQuickPostResult>;

  it("holds an Autopilot post for ten seconds so it can still be cancelled", async () => {
    const c = await setup();
    await c.autopilot();
    const { jobs } = await post(c, "agent");
    expect(Date.parse(jobs[0]!.dueAt) - c.clock.now.getTime()).toBe(10_000);
    await c.later(9_000);
    expect(c.sent).toEqual([]);
    await c.service.command(scope, { action: "cancel-job", jobId: jobs[0]!.id }, "ui");
    await c.later(5_000);
    expect(c.sent).toEqual([]);
    expect((await c.state()).jobs[0]!.state).toBe("cancelled");
  });

  it("sends the Autopilot post once the ten seconds pass, and a pressed Post button right away", async () => {
    const c = await setup();
    await c.autopilot();
    await post(c, "agent");
    await c.later(10_000);
    expect(c.sent).toEqual(["DYNAMIC_X"]);
    const pressed = await post(c, "ui");
    expect(pressed.jobs[0]!.dueAt).toBe(c.clock.now.toISOString());
  });

  it("names an account after the person who signed in", async () => {
    const c = await setup();
    expect(c.accounts[0]!.label).toBe("@x-tester");
  });

  it("reuses a sign-in that was never finished instead of piling up empty accounts", async () => {
    const c = await setup();
    const create = () =>
      c.service.command(
        scope,
        { action: "create-account", platformKey: "x", label: "X 2" },
        "ui",
      ) as Promise<MultiPostAccount>;
    const first = await create();
    expect((await create()).id).toBe(first.id);
    expect((await c.state()).accounts).toHaveLength(2);
  });

  it("clears sign-ins an older version left unfinished once one of them succeeds", async () => {
    const c = await setup([]);
    const leftover = (id: string, extra: Partial<MultiPostAccount> = {}) =>
      Effect.runPromise(
        c.sql`INSERT INTO multipost_records(kind,id,workspace_id,body) VALUES ('account',${id},${scope.workspaceId},${JSON.stringify(
          {
            id,
            workspaceId: scope.workspaceId,
            platformKey: "x",
            label: id,
            status: "disconnected",
            identity: null,
            createdAt: c.clock.now.toISOString(),
            ...extra,
          },
        )})`,
      );
    await leftover("X");
    await leftover("X 2", { status: "needs-login" });
    await leftover("Instagram", { platformKey: "instagram" });
    // A signed-out account that has posted before keeps its place in the history.
    await leftover("Old X");
    await Effect.runPromise(
      c.sql`INSERT INTO multipost_records(kind,id,workspace_id,body) VALUES ('job','old-job',${scope.workspaceId},${JSON.stringify(
        { id: "old-job", workspaceId: scope.workspaceId, accountId: "Old X", state: "published" },
      )})`,
    );
    await c.service.command(scope, { action: "verify-account", accountId: "X 2" }, "ui");
    expect((await c.state()).accounts.map((x) => x.label).toSorted()).toEqual([
      "@x-tester",
      "Instagram",
      "Old X",
    ]);
  });

  it("tidies accounts an older version named by number, the next time it looks", async () => {
    const c = await setup([]);
    const old = (id: string, extra: Partial<MultiPostAccount> = {}) =>
      Effect.runPromise(
        c.sql`INSERT INTO multipost_records(kind,id,workspace_id,body) VALUES ('account',${id},${scope.workspaceId},${JSON.stringify(
          {
            id,
            workspaceId: scope.workspaceId,
            platformKey: "x",
            label: id,
            status: "disconnected",
            identity: null,
            createdAt: c.clock.now.toISOString(),
            ...extra,
          },
        )})`,
      );
    await old("X");
    await old("x 3", {
      status: "connected",
      identity: { provider: "x", accountId: "real-user", username: "sam", verifiedAt: "" },
      checkedAt: c.clock.now.toISOString(),
    });
    await old("Shop account", {
      status: "connected",
      identity: { provider: "x", accountId: "shop", username: "shop", verifiedAt: "" },
      checkedAt: c.clock.now.toISOString(),
    });
    await old("Instagram", { platformKey: "instagram" });
    await c.service.command(scope, { action: "check-accounts" }, "ui");
    // The numbered name becomes the handle, a name the person chose stays, and the empty
    // leftover goes only where a real account for that platform exists.
    expect((await c.state()).accounts.map((x) => x.label).toSorted()).toEqual([
      "@sam",
      "Instagram",
      "Shop account",
    ]);
  });

  it("lets the user remove an account for good, but not an agent", async () => {
    const c = await setup();
    const id = c.accounts[0]!.id;
    await expect(
      c.service.command(scope, { action: "remove-account", accountId: id }, "agent"),
    ).rejects.toThrow(/user/i);
    await post(c, "ui", "2026-11-06T12:00:00Z");
    await c.service.command(scope, { action: "remove-account", accountId: id }, "ui");
    const state = await c.state();
    expect(state.accounts).toEqual([]);
    expect(state.jobs.map((job) => job.state)).toEqual(["cancelled"]);
  });

  it("notices on its own when an account was signed out", async () => {
    const c = await setup();
    await c.autopilot();
    await c.later(7 * 3_600_000);
    c.signInAs("");
    await c.service.command(scope, { action: "check-accounts" }, "ui");
    const [account] = (await c.state()).accounts;
    expect(account).toMatchObject({ status: "needs-login", checkedAt: c.clock.now.toISOString() });
    // Signing back in as the same person restores everything, Autopilot included.
    c.signInAs("real-user");
    const back = (await c.service.command(
      scope,
      { action: "verify-account", accountId: account!.id },
      "ui",
    )) as MultiPostAccount;
    expect(back).toMatchObject({ status: "connected", autopilot: { dailyLimit: 5 } });
  });

  it("does not check an account it confirmed less than six hours ago", async () => {
    const c = await setup();
    c.signInAs("");
    await c.later(3_600_000);
    await c.service.command(scope, { action: "check-accounts" }, "ui");
    expect((await c.state()).accounts[0]!.status).toBe("connected");
  });

  it("tells the desktop when a post went out, failed, or needs the person", async () => {
    const c = await setup();
    await post(c, "ui");
    await c.later(0);
    c.onPrepare(async () => {
      throw new Error("The photo was rejected");
    });
    await post(c, "ui");
    await c.later(1_000);
    c.onPrepare(async () => {});
    c.signInAs("");
    await post(c, "ui");
    await c.later(1_000);
    expect(c.notices).toEqual([
      { kind: "posted", platformKey: "x", label: "@x-tester" },
      { kind: "failed", platformKey: "x", label: "@x-tester" },
      { kind: "needs-you", platformKey: "x", label: "@x-tester" },
    ]);
  });

  const dropped = "ERR_NETWORK_CHANGED (-21) loading 'https://x.example/'";
  it("tries once more by itself when the connection drops before anything was sent", async () => {
    const c = await setup();
    let attempts = 0;
    c.onPrepare(async () => {
      if (!attempts++) throw new Error(dropped);
    });
    await post(c, "ui");
    await c.later(0);
    const waiting = (await c.state()).jobs[0]!;
    expect(waiting).toMatchObject({
      state: "queued",
      error: null,
      retriedAt: c.clock.now.toISOString(),
    });
    expect(Date.parse(waiting.dueAt) - c.clock.now.getTime()).toBe(30_000);
    // Nobody is interrupted about a problem DJL is still handling.
    expect(c.notices).toEqual([]);
    await c.later(29_000);
    expect(c.sent).toEqual([]);
    await c.later(1_000);
    expect((await c.state()).jobs[0]!.state).toBe("published");
    expect(c.sent).toEqual(["DYNAMIC_X"]);
  });

  it("gives up after that one extra try and says what happened", async () => {
    const c = await setup();
    c.onPrepare(async () => {
      throw new Error(dropped);
    });
    await post(c, "ui");
    await c.later(0);
    await c.later(30_000);
    await c.later(30_000);
    expect((await c.state()).jobs[0]).toMatchObject({ state: "failed", error: dropped });
    expect(c.notices).toEqual([{ kind: "failed", platformKey: "x", label: "@x-tester" }]);
  });

  it("does not try again for a problem that waiting cannot fix", async () => {
    const c = await setup();
    c.onPrepare(async () => {
      throw new Error("The photo was rejected");
    });
    await post(c, "ui");
    await c.later(0);
    expect((await c.state()).jobs[0]).toMatchObject({ state: "failed" });
    expect((await c.state()).jobs[0]!.retriedAt).toBeUndefined();
  });

  it("never sends a post twice when the connection drops while it is being sent", async () => {
    const c = await setup();
    c.onSubmit(async () => {
      throw new Error(dropped);
    });
    await post(c, "ui");
    await c.later(0);
    await c.later(30_000);
    expect((await c.state()).jobs[0]!.state).toBe("uncertain");
    expect(c.sent).toEqual(["DYNAMIC_X"]);
  });

  const shared = async (c: Awaited<ReturnType<typeof setup>>) => {
    c.onSubmit(async () => ({
      state: "published",
      providerConfirmation: "instagram-post-shared",
      observedAt: c.clock.now.toISOString(),
    }));
    await c.service.command(
      scope,
      { action: "quick-post", post: { text: "Hello", media: [image] } },
      "ui",
    );
    await c.later(0);
    return (await c.state()).jobs[0]!;
  };
  const check = (c: Awaited<ReturnType<typeof setup>>) =>
    c.service.command(scope, { action: "check-accounts" }, "ui");

  it("looks for a post's link as soon as it is shared without one, after saying it is live", async () => {
    const c = await setup(["instagram"]);
    c.links.found = "https://www.instagram.com/p/DCabc_123-x/";
    const job = await shared(c);
    expect(c.links.asked).toEqual([job.id]);
    expect(job).toMatchObject({
      state: "published",
      evidence: {
        providerConfirmation: "instagram-post-shared",
        postUrl: "https://www.instagram.com/p/DCabc_123-x/",
      },
    });
    expect(c.notices).toEqual([
      { kind: "posted", platformKey: "instagram", label: "@instagram-tester" },
    ]);
    await check(c);
    expect(c.links.asked).toEqual([job.id]);
  });

  it("finds the link later when the platform did not show the post at first", async () => {
    const c = await setup(["instagram"]);
    const job = await shared(c);
    expect(job).toMatchObject({ state: "published" });
    expect(job.evidence!.postUrl).toBeUndefined();
    c.links.found = "https://www.instagram.com/p/DCabc_123-x/";
    await check(c);
    expect(c.links.asked).toEqual([job.id, job.id]);
    expect((await c.state()).jobs[0]!.evidence!.postUrl).toBe(
      "https://www.instagram.com/p/DCabc_123-x/",
    );
  });

  it("only keeps a link that is a real web address, and stops looking after a day", async () => {
    const c = await setup(["instagram"]);
    c.links.found = "javascript:alert(1)";
    const job = await shared(c);
    await check(c);
    expect((await c.state()).jobs[0]!.evidence!.postUrl).toBeUndefined();
    expect(c.links.asked).toEqual([job.id, job.id]);
    c.clock.now = new Date(c.clock.now.getTime() + 25 * 3_600_000);
    await check(c);
    expect(c.links.asked).toEqual([job.id, job.id]);
  });

  it("moves a scheduled post to a new time, for the user only", async () => {
    const c = await setup();
    const { jobs } = await post(c, "ui", "2026-11-06T12:00:00.000Z");
    const move = (actor: "ui" | "agent", scheduledAt: string) =>
      c.service.command(
        scope,
        { action: "reschedule-job", jobId: jobs[0]!.id, scheduledAt },
        actor,
      );
    await expect(move("agent", "2026-11-07T12:00:00.000Z")).rejects.toThrow(/user/i);
    await expect(move("ui", "2026-11-01T12:00:00.000Z")).rejects.toThrow(/future/i);
    expect(await move("ui", "2026-11-07T09:30:00.000Z")).toMatchObject({
      state: "queued",
      dueAt: "2026-11-07T09:30:00.000Z",
      snapshot: { scheduledAt: "2026-11-07T09:30:00.000Z" },
    });
    await c.later(10_000);
    expect(c.sent).toEqual([]);
  });
});

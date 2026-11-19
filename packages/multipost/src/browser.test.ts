import { describe, expect, it } from "vitest";
import {
  createSubmissionGate,
  buildPreparationScript,
  buildVerificationScript,
  buildNativeScheduleVerificationScript,
} from "./browser";
import { adapters } from "./index";
describe("host-owned submission gate", () => {
  it("prepares without invoking deferred final submission", async () => {
    let posts = 0;
    const gate = createSubmissionGate();
    gate.defer(async () => {
      posts++;
    });
    expect(posts).toBe(0);
    await expect(gate.submit(false)).rejects.toThrow(/author/i);
    expect(posts).toBe(0);
    await gate.submit(true);
    expect(posts).toBe(1);
    await expect(gate.submit(true)).rejects.toThrow(/already/i);
  });
  it("stops pending actions after cancellation", async () => {
    const gate = createSubmissionGate();
    let posts = 0;
    gate.defer(async () => {
      posts++;
    });
    gate.cancel();
    await expect(gate.submit(true)).rejects.toThrow(/cancel/i);
    expect(posts).toBe(0);
  });
  it("embeds every public adapter with distinct content types and gated scripts", () => {
    expect(adapters).toHaveLength(110);
    expect(new Set(adapters.map((x) => x.id)).size).toBe(110);
    expect(adapters.filter((x) => x.kind === "podcast")).toHaveLength(7);
    for (const adapter of adapters) {
      const script = buildPreparationScript(
        adapter.id,
        { title: "Fixture title", content: "Fixture content" },
        {},
      );
      expect(script).toContain("Fixture title");
      expect(script).toContain("defer");
      expect(script).not.toContain("chrome.scripting");
    }
  });
});

it("blocks deferred browser actions after cancellation even inside an active submit callback", async () => {
  const gate = createSubmissionGate();
  let clicks = 0;
  gate.defer(async () => {
    gate.cancel();
    gate.perform(() => {
      clicks++;
    });
  });
  await expect(gate.submit(true)).rejects.toThrow(/cancel/i);
  expect(clicks).toBe(0);
});

it("does not claim a dispatch when the upstream adapter only offers manual completion", async () => {
  const gate = createSubmissionGate();
  gate.defer(async () => {});
  await gate.submit(true);
  expect(gate.dispatched).toBe(false);
});

it("does not mistake an existing platform post link for new publication evidence", () => {
  const previous = "https://social.example/posts/old";
  const link = { href: previous, textContent: "View post" };
  const evaluate = (state: unknown, links: unknown[]) =>
    new Function("globalThis", "document", `return ${buildVerificationScript()}`)(
      { __djlMultiPost: state },
      { querySelectorAll: () => links },
    );
  expect(evaluate({ dispatched: true, submissionHrefs: [previous] }, [link]).state).toBe(
    "uncertain",
  );
  expect(evaluate(undefined, [link]).state).toBe("uncertain");
  expect(evaluate({ dispatched: false, submissionHrefs: [] }, [link]).state).toBe("uncertain");
  expect(evaluate({ dispatched: true, submissionHrefs: [] }, [link])).toMatchObject({
    state: "published",
    postUrl: previous,
  });
});

it("requires a new post-submit native scheduling acknowledgement", () => {
  const message = "Scheduled successfully";
  const evaluate = (state: unknown) =>
    new Function("globalThis", "document", `return ${buildNativeScheduleVerificationScript()}`)(
      { __djlMultiPost: state },
      { querySelectorAll: () => [{ textContent: message }] },
    );
  expect(evaluate({ dispatched: true, submissionNotices: [message] })).toBe(false);
  expect(evaluate({ dispatched: false, submissionNotices: [] })).toBe(false);
  expect(evaluate({ dispatched: true, submissionNotices: [] })).toBe(true);
});

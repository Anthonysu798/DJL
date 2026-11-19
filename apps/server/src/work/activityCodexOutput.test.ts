import { describe, expect, it } from "vitest";
import { ActivityCodexOutput } from "./activityCodexOutput";

const content = {
  title: "Fixture review · 测试",
  description: "Reviewed the fixture draft and retained a publishing review step.",
  applications: ["com.djl.fixture"],
  memory: "A review is required before publishing.\nNo post was sent.",
  recording: "Observed the synthetic fixture draft.",
  citations: ["event-1"],
};
const start = [{ type: "thread.started", thread_id: "fixture-thread" }, { type: "turn.started" }];
const completed = {
  type: "turn.completed",
  usage: {
    input_tokens: 1,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 1,
    reasoning_output_tokens: 0,
  },
};
const item = (text = JSON.stringify(content), id = "item_0", type = "agent_message") => ({
  type: "item.completed",
  item: { id, type, text },
});
const bytes = (rows: unknown[]) =>
  Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
function decode(rows: unknown[], stderr = "", code = 0) {
  const output = new ActivityCodexOutput();
  output.write(bytes(rows));
  return output.finish({ code, signal: null }, stderr);
}
describe("no-tools activity Codex output", () => {
  it("validates canonical content from completed JSONL text without an output file", () => {
    expect(decode([...start, item(), completed])).toEqual(content);
  });
  it("normalizes only the strict wire schema's null suggestion to absence", () => {
    expect(
      decode([...start, item(JSON.stringify({ ...content, suggestion: null })), completed]),
    ).toEqual(content);
    expect(() =>
      decode([
        ...start,
        item(JSON.stringify({ ...content, suggestion: null, provider: "forged" })),
        completed,
      ]),
    ).toThrow("invalid-output");
  });
  it("handles arbitrary byte splits including multi-byte characters and EOF without LF", () => {
    const output = new ActivityCodexOutput();
    const input = bytes([...start, item(), completed]).subarray(0, -1);
    for (const byte of input) output.write(Uint8Array.of(byte));
    expect(output.finish({ code: 0, signal: null }, "")).toEqual(content);
  });
  it("accepts text/reasoning lifecycle events and uses the last completed message", () => {
    const rows = [
      ...start,
      { type: "item.started", item: { id: "r", type: "reasoning", text: "" } },
      {
        type: "item.updated",
        item: { id: "r", type: "reasoning", text: "Reviewing supplied evidence." },
      },
      item("Reviewing supplied evidence.", "r", "reasoning"),
      item("I will summarize the evidence.", "commentary"),
      { type: "item.started", item: { id: "answer", type: "agent_message", text: "" } },
      { type: "item.updated", item: { id: "answer", type: "agent_message", text: "{" } },
      item(JSON.stringify(content), "answer"),
      completed,
    ];
    expect(decode(rows)).toEqual(content);
  });
  it("accepts a grounded unexecuted suggestion as content only", () => {
    const suggested = {
      ...content,
      suggestion: {
        type: "skill",
        name: "Review draft",
        description: "Review recurring fixture drafts before publishing.",
      },
    };
    expect(decode([...start, item(JSON.stringify(suggested)), completed])).toEqual(suggested);
  });
  it("does not mistake quoted tool names in evidence-derived prose for execution", () => {
    const quoted = {
      ...content,
      recording: "The source mentioned exec_command and command_execution as text.",
    };
    expect(decode([...start, item(JSON.stringify(quoted)), completed])).toEqual(quoted);
  });
  it.each([
    "command_execution",
    "file_change",
    "mcp_tool_call",
    "collab_tool_call",
    "web_search",
    "todo_list",
    "error",
    "unknown_future_tool",
  ])("rejects %s items even when followed by valid content", (type) => {
    for (const lifecycle of ["item.started", "item.updated", "item.completed"]) {
      const output = new ActivityCodexOutput();
      output.write(bytes(start));
      expect(() =>
        output.write(
          bytes([{ type: lifecycle, item: { id: "unsafe", type, text: "private diagnostic" } }]),
        ),
      ).toThrow("invalid-output");
      expect(() => output.write(bytes([item(), completed]))).toThrow("invalid-output");
      expect(() => output.finish({ code: 0, signal: null }, "")).toThrow("invalid-output");
    }
  });
  it.each(
    [
      [...start, { type: "error", message: "private path" }, item(), completed],
      [
        ...start,
        { type: "turn.failed", error: { message: "private auth detail" } },
        item(),
        completed,
      ],
      [...start, { type: "new_event", payload: "unverified" }, item(), completed],
      [...start, { ...item(), hiddenTool: "exec_command" }, completed],
      [...start, { type: "item.completed", item: { ...item().item, extra: "tool" } }, completed],
    ].map((rows) => ({ rows })),
  )("rejects errors and unknown envelope fields without a text fallback", ({ rows }) => {
    expect(() => decode(rows)).toThrow("invalid-output");
  });
  it.each(
    [
      [item(), completed],
      [start[0], item(), completed],
      [...start, start[1], item(), completed],
      [...start, item(), item(), completed],
      [...start, completed],
      [...start, item()],
      [...start, item(), completed, item("after completion", "late")],
      [
        ...start,
        { type: "item.updated", item: { id: "missing", type: "reasoning", text: "not started" } },
        item(),
        completed,
      ],
      [
        ...start,
        { type: "item.started", item: { id: "open", type: "reasoning", text: "" } },
        item(),
        completed,
      ],
    ].map((rows) => ({ rows })),
  )("requires a complete consistent single-turn lifecycle", ({ rows }) => {
    expect(() => decode(rows)).toThrow("invalid-output");
  });
  it.each([
    "",
    "not-json",
    JSON.stringify({ ...content, provider: "forged" }),
    JSON.stringify({ ...content, citations: [] }),
    JSON.stringify({ ...content, description: "line\nbreak" }),
  ])("rejects invalid final content rather than returning a partial answer", (text) => {
    expect(() => decode([...start, item(text), completed])).toThrow("invalid-output");
  });
  it.each(["unsupported call: exec_command", "private credential diagnostic", "\n"])(
    "rejects unexplained stderr even after exit zero",
    (stderr) => {
      expect(() => decode([...start, item(), completed], stderr)).toThrow("generation-failed");
    },
  );
  it("rejects failed or signalled exits without returning captured content", () => {
    expect(() => decode([...start, item(), completed], "", 1)).toThrow("generation-failed");
    const output = new ActivityCodexOutput();
    output.write(bytes([...start, item(), completed]));
    expect(() => output.finish({ code: null, signal: "SIGTERM" }, "")).toThrow("generation-failed");
  });
  it("rejects invalid UTF-8 and incomplete frames", () => {
    for (const input of [Buffer.from([0xff, 10]), Buffer.from('{"type":"thread.started"')]) {
      const output = new ActivityCodexOutput();
      expect(() => {
        output.write(input);
        output.finish({ code: 0, signal: null }, "");
      }).toThrow("invalid-output");
    }
  });
  it("bounds line bytes, total bytes and event count", () => {
    const line = new ActivityCodexOutput();
    expect(() => line.write(Buffer.alloc(256 * 1024 + 1, 65))).toThrow("invalid-output");
    const total = new ActivityCodexOutput();
    expect(() => total.write(Buffer.alloc(1024 * 1024 + 1))).toThrow("invalid-output");
    const events = new ActivityCodexOutput();
    events.write(bytes(start));
    expect(() => {
      for (let n = 0; n < 512; n++)
        events.write(bytes([item("reasoning", String(n), "reasoning")]));
    }).toThrow("invalid-output");
  });
  it("does not accept an incomplete usage structure or negative counters", () => {
    expect(() => decode([...start, item(), { type: "turn.completed", usage: {} }])).toThrow(
      "invalid-output",
    );
    expect(() =>
      decode([...start, item(), { ...completed, usage: { ...completed.usage, input_tokens: -1 } }]),
    ).toThrow("invalid-output");
  });
});

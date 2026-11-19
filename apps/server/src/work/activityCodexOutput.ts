import { Schema } from "effect";
import { ComputerActivitySemanticContent } from "@synara/contracts";
import { ComputerActivityGenerationError } from "./computerActivitySummarization";

const invalid = () => new ComputerActivityGenerationError("invalid-output");
const id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/));
const count = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= 0));
const Item = Schema.Struct({
  id,
  type: Schema.Literals(["agent_message", "reasoning"]),
  text: Schema.String,
});
const Event = Schema.Union([
  Schema.Struct({ type: Schema.Literal("thread.started"), thread_id: id }),
  Schema.Struct({ type: Schema.Literal("turn.started") }),
  Schema.Struct({
    type: Schema.Literal("turn.completed"),
    usage: Schema.Struct({
      input_tokens: count,
      cached_input_tokens: count,
      cache_write_input_tokens: count,
      output_tokens: count,
      reasoning_output_tokens: count,
    }),
  }),
  Schema.Struct({
    type: Schema.Literals(["item.started", "item.updated", "item.completed"]),
    item: Item,
  }),
]);
const decodeEvent = Schema.decodeUnknownSync(Event);
const decodeContent = Schema.decodeUnknownSync(ComputerActivitySemanticContent);

// Incremental defense for the verified no-tools exec recipe. A valid final text
// cannot erase an earlier tool/error/unknown event. Runtime isolation is separate.
export class ActivityCodexOutput {
  private readonly line = Buffer.alloc(256 * 1024);
  private used = 0;
  private total = 0;
  private records = 0;
  private stage: "start" | "thread" | "turn" | "complete" = "start";
  private readonly items = new Map<
    string,
    { type: "agent_message" | "reasoning"; complete: boolean }
  >();
  private answer: string | undefined;
  private failed = false;
  private closed = false;

  write(chunk: Uint8Array): void {
    if (this.failed || this.closed) this.reject();
    try {
      this.total += chunk.byteLength;
      if (this.total > 1024 * 1024) this.reject();
      let offset = 0;
      while (offset < chunk.byteLength) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.byteLength : newline;
        const segment = chunk.subarray(offset, end);
        if (this.used + segment.byteLength > this.line.length) this.reject();
        this.line.set(segment, this.used);
        this.used += segment.byteLength;
        if (newline < 0) break;
        this.frame();
        this.used = 0;
        offset = end + 1;
      }
    } catch {
      this.reject();
    }
  }

  finish(
    exit: { code: number | null; signal: NodeJS.Signals | null },
    stderr: string,
  ): ComputerActivitySemanticContent {
    if (this.failed || this.closed) this.reject();
    this.closed = true;
    if (exit.code !== 0 || exit.signal !== null || stderr.length !== 0)
      throw new ComputerActivityGenerationError("generation-failed");
    try {
      if (this.used) this.frame();
      if (this.stage !== "complete" || this.answer === undefined) this.reject();
      const content = JSON.parse(this.answer);
      // Strict Structured Outputs represents an absent optional field as null.
      if (
        content &&
        typeof content === "object" &&
        !Array.isArray(content) &&
        content.suggestion === null
      )
        delete content.suggestion;
      return decodeContent(content, { onExcessProperty: "error" });
    } catch {
      return this.reject();
    }
  }

  private reject(): never {
    this.failed = true;
    throw invalid();
  }

  private frame(): void {
    if (++this.records > 512) this.reject();
    const source = new TextDecoder("utf-8", { fatal: true }).decode(
      this.line.subarray(0, this.used),
    );
    const event = decodeEvent(JSON.parse(source), { onExcessProperty: "error" });
    switch (event.type) {
      case "thread.started":
        if (this.stage !== "start") this.reject();
        this.stage = "thread";
        return;
      case "turn.started":
        if (this.stage !== "thread") this.reject();
        this.stage = "turn";
        return;
      case "turn.completed":
        if (
          this.stage !== "turn" ||
          this.answer === undefined ||
          [...this.items.values()].some((item) => !item.complete)
        )
          this.reject();
        this.stage = "complete";
        return;
      default: {
        if (this.stage !== "turn") this.reject();
        const item = event.item;
        const previous = this.items.get(item.id);
        if (previous && (previous.complete || previous.type !== item.type)) this.reject();
        if (event.type === "item.started" && previous) this.reject();
        if (event.type === "item.updated" && !previous) this.reject();
        const complete = event.type === "item.completed";
        this.items.set(item.id, { type: item.type, complete });
        if (complete && item.type === "agent_message") this.answer = item.text;
      }
    }
  }
}

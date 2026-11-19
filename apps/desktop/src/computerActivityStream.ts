import type { Readable } from "node:stream";
import {
  decodeComputerActivityNativeEvent,
  type ComputerActivityEvent,
  type ComputerActivityObservationStatus,
} from "@synara/contracts";

const MAX_FRAME = 192 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
type Reason = NonNullable<ComputerActivityObservationStatus["reason"]>;
type Binding = {
  pipe: Readable;
  failed: boolean;
  data: (chunk: Buffer | string) => void;
  closed: () => void;
};

// The activity pipe never feeds the stdout control/protection decoder.
export class ComputerActivityStream {
  private binding: Binding | undefined;
  private buffer = Buffer.alloc(0);
  private discardLine = false;
  private suspended = false;
  private epoch = "";
  private sawStatus = false;
  private current: ComputerActivityObservationStatus = { state: "inactive", droppedRecords: 0 };

  constructor(
    private readonly options: {
      epoch: () => string;
      allowed: () => boolean;
      record: (epoch: string, record: ComputerActivityEvent) => boolean;
      onFailure: (reason: Reason) => void;
      onChanged: () => void;
    },
  ) {}

  get status(): ComputerActivityObservationStatus {
    return structuredClone(this.current);
  }
  get hasChannel(): boolean {
    return !!this.binding && !this.binding.failed && !this.binding.pipe.destroyed;
  }

  attach(pipe: Readable | undefined): void {
    this.detach();
    if (pipe) {
      const binding: Binding = {
        pipe,
        failed: false,
        data: (chunk) => {
          if (this.binding === binding)
            this.receive(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), binding);
        },
        closed: () => {
          if (this.binding !== binding || binding.failed) return;
          binding.failed = true;
          this.fail("transport-unavailable");
          pipe.destroy();
        },
      };
      this.binding = binding;
      pipe.on("data", binding.data);
      pipe.on("end", binding.closed);
      pipe.on("close", binding.closed);
      pipe.on("error", binding.closed);
    }
    this.policyChanged();
  }

  detach(): void {
    const binding = this.binding;
    this.binding = undefined;
    if (binding) {
      binding.pipe.off("data", binding.data);
      binding.pipe.off("end", binding.closed);
      binding.pipe.off("close", binding.closed);
      binding.pipe.off("error", binding.closed);
      binding.pipe.once("error", () => undefined);
      binding.pipe.destroy();
    }
    this.buffer = Buffer.alloc(0);
    this.discardLine = false;
    this.policyChanged();
  }

  // Only a genuine host policy/restart transition clears an ingestion failure.
  // Keep framing across epochs: the old partial line must finish before new data.
  policyChanged(): void {
    this.epoch = this.options.epoch();
    this.suspended = false;
    this.sawStatus = false;
    this.set(
      !this.options.allowed()
        ? { state: "inactive", droppedRecords: 0 }
        : this.hasChannel
          ? { state: "starting", droppedRecords: 0 }
          : { state: "unavailable", droppedRecords: 0, reason: "transport-unavailable" },
    );
  }

  acknowledge(epoch: string, observing: boolean): void {
    if (
      epoch !== this.epoch ||
      epoch !== this.options.epoch() ||
      this.sawStatus ||
      this.suspended ||
      !this.hasChannel
    )
      return;
    this.set(
      !this.options.allowed()
        ? { state: "inactive", droppedRecords: 0 }
        : observing
          ? { state: "observing", droppedRecords: 0 }
          : { state: "unavailable", droppedRecords: 0, reason: "capture-failed" },
    );
  }

  rejectConfiguration(epoch: string, reason: Reason): void {
    if (epoch !== this.epoch || epoch !== this.options.epoch() || !this.options.allowed()) return;
    this.suspended = true;
    this.set({ state: "unavailable", droppedRecords: this.current.droppedRecords, reason });
  }

  private set(status: ComputerActivityObservationStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.current)) return;
    this.current = status;
    this.options.onChanged();
  }

  private fail(reason: Reason): void {
    if (this.suspended) {
      if (reason === "transport-unavailable" && this.options.allowed())
        this.set({ state: "unavailable", droppedRecords: this.current.droppedRecords, reason });
      return;
    }
    this.suspended = true;
    this.set(
      this.options.allowed()
        ? { state: "unavailable", droppedRecords: this.current.droppedRecords, reason }
        : { state: "inactive", droppedRecords: 0 },
    );
    if (this.options.allowed()) this.options.onFailure(reason);
  }

  private receive(chunk: Buffer, binding: Binding): void {
    let start = 0;
    while (start < chunk.length) {
      if (this.binding !== binding || binding.failed) return;
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      if (!this.discardLine && this.buffer.length + end - start > MAX_FRAME) {
        this.buffer = Buffer.alloc(0);
        this.discardLine = true;
        this.fail("capture-failed");
      }
      if (!this.discardLine) this.buffer = Buffer.concat([this.buffer, chunk.subarray(start, end)]);
      if (newline === -1) return;
      const line = this.buffer;
      this.buffer = Buffer.alloc(0);
      const discarded = this.discardLine;
      this.discardLine = false;
      if (!discarded && !this.suspended && this.options.allowed()) this.frame(line);
      start = newline + 1;
    }
  }

  private frame(line: Buffer): void {
    try {
      const raw: unknown = JSON.parse(utf8.decode(line));
      if (
        typeof raw === "object" &&
        raw !== null &&
        "event" in raw &&
        typeof raw.event === "object" &&
        raw.event !== null &&
        "epoch" in raw.event &&
        raw.event.epoch !== this.options.epoch()
      )
        return;
      const { event } = decodeComputerActivityNativeEvent(raw);
      if (event.epoch !== this.epoch || event.epoch !== this.options.epoch()) return;
      if (event.type === "activity-observer-status") {
        this.sawStatus = true;
        const { type: _type, epoch: _epoch, ...status } = event;
        this.set(status);
      } else if (
        this.current.state === "unavailable" ||
        (this.sawStatus && this.current.state !== "observing") ||
        !this.options.record(event.epoch, event.record)
      )
        this.fail("capture-failed");
    } catch {
      this.fail("capture-failed");
    }
  }
}

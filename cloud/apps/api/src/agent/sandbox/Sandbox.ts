/**
 * Where agent tools run untrusted work: user Python, and parsing PDF, docx,
 * and xlsx files (never in the API or worker process). A session is one
 * machine for one run, opened on first use and closed when the run ends.
 */
import { MACHINE_MAX_AGE_MS, type ExecResult, type FlyMachines } from "./FlyMachines.ts";

export type { ExecResult } from "./FlyMachines.ts";

export interface SandboxSession {
  readonly runPython: (code: string, signal: AbortSignal) => Promise<ExecResult>;
  /** Downloads `url` into the sandbox (outside the jail) and extracts its text inside it. */
  readonly extractText: (
    input: { readonly url: string; readonly extension: string },
    signal: AbortSignal,
  ) => Promise<ExecResult>;
  readonly close: () => Promise<void>;
}

export interface Sandbox {
  readonly open: (runId: string) => Promise<SandboxSession>;
}

export const MAX_CODE_CHARS = 60_000;

/** Fly-backed sandbox; the machine is created lazily and replaced before it ages out. */
export function createFlySandbox(
  machines: Pick<FlyMachines, "create" | "exec" | "destroy">,
): Sandbox {
  return {
    async open(runId) {
      let current: { readonly id: string; readonly at: number } | null = null;
      const machine = async () => {
        if (current && Date.now() - current.at > MACHINE_MAX_AGE_MS) {
          const old = current;
          current = null;
          await machines.destroy(old.id);
        }
        current ??= { id: (await machines.create(runId)).id, at: Date.now() };
        return current.id;
      };
      return {
        async runPython(code, signal) {
          const encoded = Buffer.from(code, "utf8").toString("base64");
          return machines.exec(await machine(), ["/opt/djl/run-python", encoded], signal);
        },
        async extractText({ url, extension }, signal) {
          const id = await machine();
          const name = `input.${extension}`;
          const fetched = await machines.exec(id, ["/opt/djl/fetch-input", url, name], signal);
          if (fetched.exitCode !== 0) return fetched;
          const extracted = await machines.exec(id, ["/opt/djl/extract-text", name], signal);
          return { ...extracted, seconds: fetched.seconds + extracted.seconds };
        },
        async close() {
          if (current) await machines.destroy(current.id);
          current = null;
        },
      };
    },
  };
}

const canned = (stdout: string): ExecResult => ({ exitCode: 0, stdout, stderr: "", seconds: 1 });

/**
 * Mock mode: runs NOTHING. Returns canned output so the agent loop can be
 * exercised locally without ever executing user code on the host.
 */
export function createMockSandbox() {
  const state = { opened: 0, closed: 0, execs: [] as { kind: string; input: string }[] };
  const sandbox: Sandbox = {
    async open() {
      state.opened += 1;
      return {
        async runPython(code) {
          state.execs.push({ kind: "python", input: code });
          return canned("[mock sandbox] The code was not executed.\n");
        },
        async extractText({ extension }) {
          state.execs.push({ kind: "extract", input: extension });
          return canned(`[mock sandbox] Extracted text of a .${extension} file.`);
        },
        async close() {
          state.closed += 1;
        },
      };
    },
  };
  return Object.assign(sandbox, { state });
}

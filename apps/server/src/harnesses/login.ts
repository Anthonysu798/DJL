import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type {
  HarnessId,
  HarnessLoginInput,
  HarnessLoginResult,
  ServerSettings,
} from "@synara/contracts";
import type { TerminalManagerShape } from "../terminal/Services/Manager";
import { buildHarnessInvocation, probeHarnessAccount } from "./accounts";

export function createHarnessLoginController(input: {
  terminal: Pick<TerminalManagerShape, "open" | "isRunning" | "close">;
  cwd: string;
  managedRootDir: string;
}) {
  type Entry = {
    promise: Promise<HarnessLoginResult>;
    cancelled: boolean;
    settled: boolean;
    modelProviderId?: string;
  };
  const active = new Map<HarnessId, Entry>();
  const cancel = async (harness: HarnessId, entry: Entry) => {
    entry.cancelled = true;
    try {
      const session = await entry.promise.catch(() => undefined);
      if (session)
        await Effect.runPromise(input.terminal.close({ ...session, deleteHistory: true }));
    } finally {
      if (active.get(harness) === entry) active.delete(harness);
    }
  };
  const bindCancellation = (harness: HarnessId, entry: Entry, signal?: AbortSignal) => {
    if (!signal) return;
    const abort = () => {
      void cancel(harness, entry).catch(() => undefined);
    };
    if (signal.aborted) abort();
    else {
      signal.addEventListener("abort", abort, { once: true });
      const remove = () => signal.removeEventListener("abort", abort);
      void entry.promise.then(remove, remove);
    }
  };
  const start = (
    request: HarnessLoginInput,
    settings: ServerSettings | (() => Promise<ServerSettings>),
    signal?: AbortSignal,
  ): Promise<HarnessLoginResult> => {
    const previous = active.get(request.harness);
    if (previous && previous.modelProviderId !== request.modelProviderId)
      return Promise.reject(
        new Error("Close the current sign-in before connecting another provider."),
      );
    if (previous && !previous.settled) {
      bindCancellation(request.harness, previous, signal);
      return previous.promise;
    }
    let entry!: Entry;
    const promise = (async () => {
      const resolvedSettings = await (typeof settings === "function" ? settings() : settings);
      if (entry.cancelled) throw new Error("Sign-in cancelled.");
      if (previous) {
        const session = await previous.promise;
        if (await Effect.runPromise(input.terminal.isRunning(session))) return session;
        await Effect.runPromise(input.terminal.close({ ...session, deleteHistory: true }));
      }
      const account = await probeHarnessAccount(
        request.harness,
        resolvedSettings,
        input.managedRootDir,
      );
      if (entry.cancelled) throw new Error("Sign-in cancelled.");
      if (!account.enabled) throw new Error("Enable this harness before signing in.");
      if (!account.installed)
        throw new Error("Install the official harness command-line tool before signing in.");
      if (request.harness === "opencode" && account.status === "incompatible")
        throw new Error(
          "Update OpenCode to a supported version and check the provider setup guide before signing in.",
        );
      if (request.harness !== "opencode" && request.modelProviderId)
        throw new Error("Model-provider login requires OpenCode.");
      const invocation = buildHarnessInvocation(
        request.harness,
        resolvedSettings,
        input.managedRootDir,
      );
      const result: HarnessLoginResult = {
        harness: request.harness,
        threadId: `harness-login-${randomUUID()}`,
        terminalId: "default",
        cwd: input.cwd,
      };
      // Only provider-specific changes enter the override channel. The manager
      // still removes host terminal identity and pins the embedded TERM.
      const env = Object.fromEntries(
        Object.entries(invocation.env).filter(
          (pair): pair is [string, string] =>
            pair[1] !== undefined && pair[1] !== process.env[pair[0]],
        ),
      );
      const removeEnv =
        request.harness === "opencode"
          ? Object.keys(process.env).filter((key) => invocation.env[key] === undefined)
          : [];
      try {
        const snapshot = await Effect.runPromise(
          input.terminal.open(
            { ...result, env },
            {
              executable: invocation.binary,
              args: [
                ...invocation.prefixArgs,
                ...invocation.loginArgs,
                ...(request.modelProviderId ? ["--provider", request.modelProviderId] : []),
              ],
              removeEnv,
            },
          ),
        );
        if (entry.cancelled) throw new Error("Sign-in cancelled.");
        if (snapshot.status !== "running") throw new Error("The sign-in terminal could not start.");
        return result;
      } catch (error) {
        await Effect.runPromise(input.terminal.close({ ...result, deleteHistory: true })).catch(
          () => undefined,
        );
        throw error;
      }
    })();
    entry = {
      promise,
      cancelled: false,
      settled: false,
      ...(request.modelProviderId ? { modelProviderId: request.modelProviderId } : {}),
    };
    active.set(request.harness, entry);
    bindCancellation(request.harness, entry, signal);
    void promise.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
    void entry.promise.catch(() => {
      if (active.get(request.harness) === entry) active.delete(request.harness);
    });
    return entry.promise;
  };
  const end = async (harness: HarnessId) => {
    const entry = active.get(harness);
    if (!entry) return;
    await cancel(harness, entry);
  };
  return { start, end, dispose: () => Promise.all([...active.keys()].map(end)) };
}

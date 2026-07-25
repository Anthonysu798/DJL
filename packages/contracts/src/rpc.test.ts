import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { WsAutomationCreateRpc, WsProjectsDiscoverScriptsRpc, WsRpcError, WsRpcGroup } from "./rpc";

describe("WS RPC contracts", () => {
  it("exports the additive Effect RPC group", () => {
    expect(WsRpcGroup).toBeDefined();
  });

  it("uses a schema-backed transport error", () => {
    expect(new WsRpcError({ message: "failed" }).message).toBe("failed");
  });

  it("carries an optional failed command receipt for mutation errors", () => {
    const error = Schema.decodeUnknownSync(WsRpcError)({
      _tag: "WsRpcError",
      message: "rejected",
      commandId: "command-mobile-failed",
      status: "failed",
    });

    expect(error.commandId).toBe("command-mobile-failed");
    expect(error.status).toBe("failed");
  });

  it("exports the project script discovery RPC", () => {
    expect(WsProjectsDiscoverScriptsRpc).toBeDefined();
  });

  it("exports the automation create RPC", () => {
    expect(WsAutomationCreateRpc).toBeDefined();
  });
});

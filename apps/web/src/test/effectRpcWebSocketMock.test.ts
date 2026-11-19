import { expect, it } from "vitest";
import { COMPUTER_WS_METHODS, ORCHESTRATION_WS_METHODS, WS_METHODS } from "@synara/contracts";
import { isEffectRpcSubscriptionMethod } from "./effectRpcWebSocketMock";

it("keeps computer event subscriptions open alongside shell and server streams", () => {
  expect(isEffectRpcSubscriptionMethod(COMPUTER_WS_METHODS.subscribeEvents)).toBe(true);
  expect(isEffectRpcSubscriptionMethod(ORCHESTRATION_WS_METHODS.subscribeShell)).toBe(true);
  expect(isEffectRpcSubscriptionMethod(WS_METHODS.subscribeServerLifecycle)).toBe(true);
  expect(isEffectRpcSubscriptionMethod(COMPUTER_WS_METHODS.getStatus)).toBe(false);
});

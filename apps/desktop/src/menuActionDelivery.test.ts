import { describe, expect, it } from "vitest";
import { createMenuActionDelivery } from "./menuActionDelivery";

describe("desktop menu action delivery", () => {
  it("queues startup actions until their owner subscribes without replaying them on remount", () => {
    const delivery = createMenuActionDelivery();
    const received: string[] = [];
    delivery.receive("open-settings");
    delivery.subscribe((action) => received.push(`unrelated:${action}`));
    expect(received).toEqual([]);

    const unsubscribe = delivery.subscribe((action) => received.push(action), ["open-settings"]);
    expect(received).toEqual(["open-settings"]);
    unsubscribe();
    delivery.subscribe((action) => received.push(`remounted:${action}`), ["open-settings"]);
    expect(received).toEqual(["open-settings"]);
  });

  it("uses a fixed subscriber snapshot while callbacks unsubscribe and subscribe", () => {
    const delivery = createMenuActionDelivery();
    const received: string[] = [];
    let unsubscribeSecond: () => void;
    let added = false;
    delivery.subscribe(() => {
      received.push("first");
      unsubscribeSecond();
      if (!added) {
        added = true;
        delivery.subscribe(() => received.push("new"));
      }
    });
    unsubscribeSecond = delivery.subscribe(() => received.push("second"));

    delivery.receive("new-thread");
    expect(received).toEqual(["first", "second"]);
    delivery.receive("new-thread");
    expect(received).toEqual(["first", "second", "first", "new"]);
  });

  it("keeps separate subscriptions for the same callback and ignores non-string actions", () => {
    const delivery = createMenuActionDelivery();
    const received: string[] = [];
    const listener = (action: string) => received.push(action);
    const unsubscribe = delivery.subscribe(listener);
    delivery.subscribe(listener);
    delivery.receive(null);
    expect(received).toEqual([]);
    delivery.receive("new-thread");
    expect(received).toEqual(["new-thread", "new-thread"]);
    unsubscribe();
    delivery.receive("new-thread");
    expect(received).toEqual(["new-thread", "new-thread", "new-thread"]);
  });

  it("does not replay a consumed command or retain its subscriber after a callback throws", () => {
    const delivery = createMenuActionDelivery();
    const received: string[] = [];
    delivery.receive("show-shortcuts");
    expect(() =>
      delivery.subscribe(() => {
        throw new Error("Synthetic menu handler failure");
      }, ["show-shortcuts"]),
    ).toThrow("Synthetic menu handler failure");
    delivery.subscribe((action) => received.push(action), ["show-shortcuts"]);
    expect(received).toEqual([]);
    expect(() => delivery.receive("show-shortcuts")).not.toThrow();
    expect(received).toEqual(["show-shortcuts"]);
  });
});

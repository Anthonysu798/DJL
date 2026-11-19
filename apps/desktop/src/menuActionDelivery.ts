// Only these actions have owners in every AI shell, independent of the active route.
const startupActions = new Set(["show-shortcuts", "toggle-sidebar", "open-settings"]);

export function createMenuActionDelivery() {
  const subscriptions = new Set<{ listener: (action: string) => void }>();
  const initializedActions = new Set<string>();
  let pending: string[] = [];

  return {
    receive(action: unknown) {
      if (typeof action !== "string") return;
      if (startupActions.has(action) && !initializedActions.has(action)) {
        pending.push(action);
        return;
      }
      // Callbacks can change subscriptions; finish this dispatch using its original snapshot.
      const snapshot = [...subscriptions];
      for (const { listener } of snapshot) listener(action);
    },
    subscribe(listener: (action: string) => void, actions: readonly string[] = []) {
      const subscription = { listener };
      subscriptions.add(subscription);
      const supported = new Set(actions);
      for (const action of supported) initializedActions.add(action);

      // Consume before callbacks: effect remounts must not replay an executed command.
      const replay = pending.filter((action) => supported.has(action));
      pending = pending.filter((action) => !supported.has(action));
      try {
        for (const action of replay) listener(action);
      } catch (error) {
        subscriptions.delete(subscription);
        throw error;
      }
      return () => {
        subscriptions.delete(subscription);
      };
    },
  };
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export type CheckoutAttemptMarker =
  | { readonly kind: "empty" | "unavailable" }
  | { readonly kind: "pending"; readonly key: string };

export function checkoutAttemptStorageKey(scoped: boolean, userId: string): string {
  return [
    "djl-commerce-order-attempt-v1",
    scoped ? "scoped" : "web",
    encodeURIComponent(userId),
  ].join(":");
}

export function readCheckoutAttempt(storageKey: string): CheckoutAttemptMarker {
  try {
    const key = window.sessionStorage.getItem(storageKey);
    if (key === null) return { kind: "empty" };
    if (uuid.test(key)) return { kind: "pending", key };
  } catch {
    /* A missing permission is not proof that there was no previous attempt. */
  }
  return { kind: "unavailable" };
}

export function saveCheckoutAttempt(storageKey: string, key: string): boolean {
  if (!uuid.test(key)) return false;
  try {
    const storage = window.sessionStorage;
    if (storage.getItem(storageKey) !== null) return false;
    storage.setItem(storageKey, key);
    return storage.getItem(storageKey) === key;
  } catch {
    return false;
  }
}

export function clearCheckoutAttempt(storageKey: string, key: string): boolean {
  try {
    const storage = window.sessionStorage;
    const current = storage.getItem(storageKey);
    if (current === null) return true;
    if (current !== key) return false;
    storage.removeItem(storageKey);
    return storage.getItem(storageKey) === null;
  } catch {
    return false;
  }
}

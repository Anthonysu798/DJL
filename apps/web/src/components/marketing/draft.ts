import { useEffect, useState } from "react";
import type { Stored } from "./client";
export interface Draft<T> {
  base: Stored<T>;
  value: T;
}
export const initialDraft = <T>(base: Stored<T>): Draft<T> => ({ base, value: base.value });
export const editDraft = <T>(draft: Draft<T>, value: T): Draft<T> => ({ ...draft, value });
export const isDirty = <T>(draft: Draft<T>) =>
  JSON.stringify(draft.value) !== JSON.stringify(draft.base.value);
export const receiveDraft = <T>(draft: Draft<T>, incoming: Stored<T>): Draft<T> =>
  isDirty(draft) || incoming.version <= draft.base.version ? draft : initialDraft(incoming);
export function useDraft<T>(incoming: Stored<T>) {
  const [draft, setDraft] = useState(() => initialDraft(incoming));
  const dirty = isDirty(draft);
  useEffect(() => {
    setDraft((current) => receiveDraft(current, incoming));
  }, [incoming, dirty]);
  return {
    value: draft.value,
    version: draft.base.version,
    dirty,
    setValue: (value: T | ((previous: T) => T)) =>
      setDraft((current) =>
        editDraft(
          current,
          typeof value === "function" ? (value as (previous: T) => T)(current.value) : value,
        ),
      ),
    accept: (saved: Stored<T>) => setDraft(initialDraft(saved)),
  };
}

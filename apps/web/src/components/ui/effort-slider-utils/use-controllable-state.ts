// FILE: use-controllable-state.ts
// Purpose: State that is controlled when `value` is given and internal otherwise.

import * as React from "react";

type Updater<T> = T | ((previous: T) => T);

export function useControllableState<T>(input: {
  value: T | undefined;
  defaultValue: T;
  onChange?: ((value: T) => void) | undefined;
}): [T, (next: Updater<T>) => void] {
  const { value, defaultValue, onChange } = input;
  const [internal, setInternal] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  // Updaters read the latest value, so several changes before a re-render still add up.
  const latest = React.useRef(current);
  latest.current = current;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const setValue = React.useCallback(
    (next: Updater<T>) => {
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(latest.current) : next;
      if (Object.is(resolved, latest.current)) return;
      latest.current = resolved;
      if (!controlled) setInternal(resolved);
      onChangeRef.current?.(resolved);
    },
    [controlled],
  );

  return [current, setValue];
}

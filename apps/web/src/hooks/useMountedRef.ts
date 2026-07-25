// FILE: useMountedRef.ts
// Purpose: Tracks whether a component is mounted without getting stuck false after Strict Mode's development remount.
// Layer: Shared React hook

import { useEffect, useRef } from "react";

export function useMountedRef() {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}

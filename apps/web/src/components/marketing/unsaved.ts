import { createContext, useContext, useEffect } from "react";
export const UnsavedContext = createContext<(dirty: boolean) => void>(() => undefined);
export function useUnsaved(dirty: boolean) {
  const report = useContext(UnsavedContext);
  useEffect(() => {
    report(dirty);
    return () => report(false);
  }, [dirty, report]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

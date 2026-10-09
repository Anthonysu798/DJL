/**
 * Browser wiring for the mock API. The database lives in localStorage so a
 * reload keeps chats and running streams. Pick a scenario with
 * `localStorage["djl.mock.scenario"] = "exhausted" | "empty"` (read on first
 * load) and start over with `localStorage.removeItem("djl.mock.db")`.
 */
import type { FetchLike } from "../client";
import { createMockApi, type MockDb, type MockScenario } from "./server";

const DB_KEY = "djl.mock.db";
const SCENARIO_KEY = "djl.mock.scenario";

export function createBrowserMockFetch(baseUrl: string): FetchLike {
  const scenario = (safeGet(SCENARIO_KEY) as MockScenario | null) ?? "default";
  const api = createMockApi({
    baseUrl,
    scenario,
    latencyMs: 120,
    tickMs: Number(safeGet("djl.mock.tickMs") ?? 35),
    appOrigin: window.location.origin,
    persist: {
      load: () => {
        const raw = safeGet(DB_KEY);
        return raw ? (JSON.parse(raw) as MockDb) : null;
      },
      save: (db) => {
        try {
          localStorage.setItem(DB_KEY, JSON.stringify(db));
        } catch {
          /* quota: keep running in memory */
        }
      },
    },
  });
  return api.fetch;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

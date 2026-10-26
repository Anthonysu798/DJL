"use client";
import { ProductAnalyticsClient, type AnalyticsClientState } from "@synara/shared/productAnalytics";
import type { AnalyticsFeature } from "@synara/contracts/cloud";
import { API_URL } from "./config";
import { csrf } from "./api";

const KEY = "djl_cloud_product_analytics";
export const ANALYTICS_PREFERENCE_EVENT = "djl-web-analytics-preference";
let active: ProductAnalyticsClient | null = null;

export function createWebAnalytics(scope: () => string): ProductAnalyticsClient {
  return new ProductAnalyticsClient({
    metadata: {
      platform: "web",
      appVersion: "0.1.0",
      osVersion: "unknown",
      channel: process.env.NODE_ENV === "production" ? "stable" : "development",
    },
    context: async () => ({ apiBaseUrl: API_URL, scope: scope() }),
    storage: {
      read: async () => {
        try {
          const raw = localStorage.getItem(KEY);
          return raw ? (JSON.parse(raw) as AnalyticsClientState) : null;
        } catch {
          return null;
        }
      },
      write: async (state) => {
        try {
          localStorage.setItem(KEY, JSON.stringify(state));
        } catch {
          /* storage is optional */
        }
      },
    },
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-csrf-token", await csrf());
      return fetch(url, { ...init, headers, credentials: "include" });
    },
  });
}
export function attachWebAnalytics(client: ProductAnalyticsClient | null): void {
  active = client;
}
export function webAnalyticsEnabled(): boolean {
  return active?.isEnabled() ?? false;
}
export async function setWebAnalyticsEnabled(enabled: boolean): Promise<boolean> {
  if (!active) return false;
  await active.setEnabled(enabled);
  window.dispatchEvent(new Event(ANALYTICS_PREFERENCE_EVENT));
  return active.isEnabled();
}
export function recordWebFeature(feature: AnalyticsFeature): void {
  void active?.recordFeature(feature);
}

/**
 * The app-wide chat client. Talks to NEXT_PUBLIC_API_URL, or to the in-browser
 * mock when NEXT_PUBLIC_DJL_MOCK_API=true (the mock is code-split out of
 * builds that don't enable it).
 */
import { API_URL } from "@/lib/config";

import { createChatClient, type FetchLike } from "./client";

export const MOCK_API = process.env.NEXT_PUBLIC_DJL_MOCK_API === "true";

let mockFetch: Promise<FetchLike> | null = null;

const fetchImpl: FetchLike = MOCK_API
  ? async (input, init) => {
      mockFetch ??= import("./mock/browser").then((m) => m.createBrowserMockFetch(API_URL));
      return (await mockFetch)(input, init);
    }
  : (input, init) => fetch(input, init);

export const chatClient = createChatClient({ baseUrl: API_URL, fetch: fetchImpl });

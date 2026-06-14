import "server-only";
import type { WebSearchResult } from "./types";

// Brave Search API wrapper. Server-only — the key is never exposed to the client.
// Never throws: on any failure it logs server-side and returns [] so callers
// always get a usable array.

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}
interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

export async function searchWeb(
  query: string,
  count = 5
): Promise<WebSearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) {
    console.error("[brave] BRAVE_SEARCH_API_KEY is not set");
    return [];
  }
  try {
    const url =
      `https://api.search.brave.com/res/v1/web/search` +
      `?q=${encodeURIComponent(query)}` +
      `&count=${count}` +
      `&text_decorations=false` +
      `&search_lang=en`;
    const res = await fetch(url, {
      headers: {
        "X-Subscription-Token": key,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.error(`[brave] search failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const json = (await res.json()) as BraveResponse;
    const results = json.web?.results ?? [];
    return results.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      description: r.description ?? "",
    }));
  } catch (err) {
    console.error("[brave] search error", err);
    return [];
  }
}

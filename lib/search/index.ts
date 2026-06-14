import "server-only";
import { searchWeb as searchBrave } from "./brave";
import { searchSerper, serperConfigured } from "./serper";
import type { WebSearchResult } from "./types";

export function searchConfigured(): boolean {
  return serperConfigured() || Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim());
}

export async function searchWeb(query: string, count = 5): Promise<WebSearchResult[]> {
  if (serperConfigured()) {
    const serperResults = await searchSerper(query, count);
    if (serperResults.length > 0) return serperResults;
  }

  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) {
    return searchBrave(query, count);
  }

  console.error("[search] no search provider configured");
  return [];
}

import "server-only";
import type { WebSearchResult } from "./types";

const SERPER_SEARCH_URL = "https://google.serper.dev/search";

interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
  message?: string;
}

function serperApiKey(): string | undefined {
  const key = process.env.SERPER_API_KEY?.trim();
  return key || undefined;
}

export function serperConfigured(): boolean {
  return Boolean(serperApiKey());
}

export async function searchSerper(
  query: string,
  count = 5
): Promise<WebSearchResult[]> {
  const key = serperApiKey();
  if (!key) {
    console.error("[serper] SERPER_API_KEY is not set");
    return [];
  }

  try {
    const res = await fetch(SERPER_SEARCH_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: count,
        gl: "us",
        hl: "en",
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[serper] search failed: ${res.status} ${res.statusText}`, detail);
      return [];
    }

    const json = (await res.json()) as SerperResponse;
    return (json.organic ?? [])
      .map((result) => ({
        title: result.title ?? "",
        url: result.link ?? "",
        description: result.snippet ?? "",
      }))
      .filter((result) => result.title && result.url);
  } catch (err) {
    console.error("[serper] search error", err);
    return [];
  }
}

// Shared web-search result shape. Kept dependency-free so both providers
// (Serper, Brave) and the orchestrator can import it without cycles.

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

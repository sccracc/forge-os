// Client-safe usage shapes (no server-only imports). The /api/data/usage route
// maps the snake_case `usage` row → this camelCase snapshot (timestamps → ms).

export interface UsageSnapshot {
  window5hForgeTokens: number;
  window5hOpenedAt: number | null;
  weeklyForgeTokens: number;
  weeklyOpenedAt: number | null;
  dailyForgeTokens: number;
  dailyResetAt: number | null;
  imagesThisMonth: number;
  visionThisMonth: number;
  searchesThisMonth: number;
  documentsThisMonth: number;
  voiceInputMinutesThisMonth: number;
  voiceOutputCharsThisMonth: number;
  codeExecutionsThisMonth: number;
  monthResetAt: number | null;
}

export interface UsagePayload {
  plan: string;
  usage: UsageSnapshot;
}

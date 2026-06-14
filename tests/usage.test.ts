import { describe, expect, it } from "vitest";
import {
  tokenStatus,
  indicatorLevel,
  progressColor,
  formatHrMin,
  formatDaysHr,
  formatUsagePercent,
  FIVE_HOURS_MS,
  WEEK_MS,
} from "@/lib/usage/compute";
import type { UsageSnapshot } from "@/lib/usage/types";

const NOW = 1_700_000_000_000;

function snap(over: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    window5hForgeTokens: 0,
    window5hOpenedAt: null,
    weeklyForgeTokens: 0,
    weeklyOpenedAt: null,
    dailyForgeTokens: 0,
    dailyResetAt: null,
    imagesThisMonth: 0,
    visionThisMonth: 0,
    searchesThisMonth: 0,
    documentsThisMonth: 0,
    voiceInputMinutesThisMonth: 0,
    voiceOutputCharsThisMonth: 0,
    codeExecutionsThisMonth: 0,
    monthResetAt: null,
    ...over,
  };
}

describe("indicatorLevel thresholds", () => {
  it("hides below 80%, then amber / orange / full", () => {
    expect(indicatorLevel(0)).toBe("hidden");
    expect(indicatorLevel(79.9)).toBe("hidden");
    expect(indicatorLevel(80)).toBe("amber");
    expect(indicatorLevel(94.9)).toBe("amber");
    expect(indicatorLevel(95)).toBe("orange");
    expect(indicatorLevel(99.9)).toBe("orange");
    expect(indicatorLevel(100)).toBe("full");
    expect(indicatorLevel(140)).toBe("full");
  });
});

describe("tokenStatus — free (daily)", () => {
  it("computes percent + remaining within an active day", () => {
    const s = tokenStatus("free", snap({ dailyForgeTokens: 6000, dailyResetAt: NOW + 1000 }), NOW);
    expect(Math.round(s.pctRaw)).toBe(80);
    expect(s.remaining).toBe(20);
    expect(s.full).toBe(false);
    expect(s.blocking).toBeNull();
  });

  it("marks full + blocking=daily at the cap", () => {
    const s = tokenStatus("free", snap({ dailyForgeTokens: 7500, dailyResetAt: NOW + 1000 }), NOW);
    expect(s.full).toBe(true);
    expect(s.blocking).toBe("daily");
  });

  it("treats a stale (expired) daily counter as 0", () => {
    const s = tokenStatus("free", snap({ dailyForgeTokens: 999999, dailyResetAt: NOW - 1000 }), NOW);
    expect(s.pctRaw).toBe(0);
    expect(s.full).toBe(false);
  });
});

describe("tokenStatus — paid (5h + weekly)", () => {
  it("uses max(5h, weekly) and flags the 5h window when full", () => {
    const s = tokenStatus(
      "pro",
      snap({
        window5hForgeTokens: 500_000, // pro 5h limit
        window5hOpenedAt: NOW - 1000,
        weeklyForgeTokens: 1_250_000, // half of 2.5M weekly
        weeklyOpenedAt: NOW - 1000,
      }),
      NOW
    );
    expect(s.full).toBe(true);
    expect(s.blocking).toBe("5h");
    expect(s.resetsAt).toBe(NOW - 1000 + FIVE_HOURS_MS);
  });

  it("ignores a closed window's stale counter", () => {
    const s = tokenStatus(
      "pro",
      snap({ window5hForgeTokens: 500_000, window5hOpenedAt: NOW - FIVE_HOURS_MS - 1 }),
      NOW
    );
    expect(s.pctRaw).toBe(0);
    expect(s.full).toBe(false);
  });

  it("flags weekly when only the week is full", () => {
    const s = tokenStatus(
      "starter",
      snap({ weeklyForgeTokens: 750_000, weeklyOpenedAt: NOW - 1000 }),
      NOW
    );
    expect(s.blocking).toBe("weekly");
    expect(s.resetsAt).toBe(NOW - 1000 + WEEK_MS);
  });
});

describe("formatting + colors", () => {
  it("formats hours/minutes and days/hours", () => {
    expect(formatHrMin(0)).toBe("0min");
    expect(formatHrMin(2 * 3600_000 + 14 * 60_000)).toBe("2hr 14min");
    expect(formatHrMin(45 * 60_000)).toBe("45min");
    expect(formatDaysHr(3 * 86400_000 + 5 * 3600_000)).toBe("3 days 5hr");
    expect(formatDaysHr(1 * 86400_000)).toBe("1 day 0hr");
  });

  it("color-codes by percent (green→amber→orange→red)", () => {
    expect(progressColor(10)).toBe("var(--ok)");
    expect(progressColor(75)).toBe("var(--amber)");
    expect(progressColor(90)).toBe("#f97316");
    expect(progressColor(100)).toBe("var(--danger)");
  });

  it("formats clamped whole usage percentages", () => {
    expect(formatUsagePercent(37.4)).toBe("37%");
    expect(formatUsagePercent(37.5)).toBe("38%");
    expect(formatUsagePercent(140)).toBe("100%");
    expect(formatUsagePercent(Number.NaN)).toBe("0%");
  });
});

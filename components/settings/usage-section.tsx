"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useUsageStore } from "@/lib/store/usage-store";
import { PLAN_LIMITS, resolvePlanId } from "@/lib/plans/limits";
import { imageModelLabelForPlan } from "@/lib/images/public";
import {
  isFreePlan,
  progressColor,
  formatHrMin,
  formatDaysHr,
  formatUsagePercent,
  FIVE_HOURS_MS,
  WEEK_MS,
} from "@/lib/usage/compute";

const subStyle: CSSProperties = { fontSize: 12.5, color: "var(--text-dim)" };
const labelStyle: CSSProperties = { fontSize: 13.5, fontWeight: 600 };

function Bar({ pct }: { pct: number }) {
  return (
    <div
      style={{
        height: 8,
        borderRadius: 6,
        background: "var(--bg-elev2)",
        overflow: "hidden",
        margin: "8px 0 6px",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: progressColor(pct),
          borderRadius: 6,
          // Family 14: determinate fills ease on --ease-smooth (inline equivalent).
          transition: "width .3s cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      />
    </div>
  );
}

function TokenInfoBox() {
  return (
    <div
      style={{
        marginTop: 18,
        padding: "14px 16px",
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        fontSize: 13,
        color: "var(--text-dim)",
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
        How Forge Usage Works
      </div>
      Your usage window is shared across AI work. Different models and settings use your allowance at
      different rates:
      <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
        <li>Spark 2.5 = 1×</li>
        <li>Spark 2.5 + Thinking = 2×</li>
        <li>Magnum 2.8 = 5×</li>
        <li>Magnum 2.8 + Thinking = 10×</li>
      </ul>
      Heavier settings burn your window faster but give more powerful results.
    </div>
  );
}

interface FeatureRow {
  label: string;
  used: number;
  limit: number;
  unit?: "min" | "chars";
}

/** Usage section for the settings page (rendered inside a Card). Live-ticks the
 *  rolling-window countdowns every second. */
export function UsageSection() {
  const usage = useUsageStore((s) => s.usage);
  const plan = useUsageStore((s) => s.plan);
  const loaded = useUsageStore((s) => s.loaded);
  const refresh = useUsageStore((s) => s.refresh);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live countdown — re-render every second.
  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const id = setInterval(updateNow, 1000);
    return () => clearInterval(id);
  }, []);

  if (!usage) {
    return <p style={subStyle}>{loaded ? "No usage recorded yet." : "Loading usage…"}</p>;
  }

  if (now == null) {
    return <p style={subStyle}>Loading usage...</p>;
  }

  const limits = PLAN_LIMITS[resolvePlanId(plan)];

  // ---- Free plan: daily tokens ----
  if (isFreePlan(plan)) {
    const limit = limits.daily_forge_tokens ?? 7500;
    const active = usage.dailyResetAt != null && now < usage.dailyResetAt;
    const used = active ? usage.dailyForgeTokens : 0;
    const pct = limit ? (used / limit) * 100 : 0;
    return (
      <div>
        <div style={labelStyle}>Daily Usage</div>
        <Bar pct={pct} />
        <div style={subStyle}>
          {formatUsagePercent(pct)} used today
        </div>
        <div style={{ ...subStyle, marginTop: 2 }}>Resets at midnight UTC</div>
        <TokenInfoBox />
      </div>
    );
  }

  // ---- Paid plans: 5-hour + weekly windows + monthly features ----
  const limit5h = limits.window_5h_forge_tokens;
  const reset5h = usage.window5hOpenedAt != null ? usage.window5hOpenedAt + FIVE_HOURS_MS : null;
  const open5h = reset5h != null && now < reset5h;
  const used5h = open5h ? usage.window5hForgeTokens : 0;
  const pct5h = limit5h ? (used5h / limit5h) * 100 : 0;

  const limitWeek = limits.weekly_forge_tokens;
  const resetWeek = usage.weeklyOpenedAt != null ? usage.weeklyOpenedAt + WEEK_MS : null;
  const openWeek = resetWeek != null && now < resetWeek;
  const usedWeek = openWeek ? usage.weeklyForgeTokens : 0;
  const pctWeek = limitWeek ? (usedWeek / limitWeek) * 100 : 0;

  const imageUsageLabel = imageModelLabelForPlan(plan);
  const features: FeatureRow[] = [
    {
      label: imageUsageLabel === "Not included" ? "Image generation" : imageUsageLabel,
      used: usage.imagesThisMonth,
      limit: limits.images,
    },
    { label: "Image understanding", used: usage.visionThisMonth, limit: limits.vision },
    { label: "Web searches", used: usage.searchesThisMonth, limit: limits.searches },
    { label: "Document uploads", used: usage.documentsThisMonth, limit: limits.documents },
    {
      label: "Voice input",
      used: usage.voiceInputMinutesThisMonth,
      limit: limits.voice_input_minutes,
      unit: "min",
    },
    {
      label: "Voice output",
      used: usage.voiceOutputCharsThisMonth,
      limit: limits.voice_output_chars,
      unit: "chars",
    },
    { label: "Code executions", used: usage.codeExecutionsThisMonth, limit: limits.code_executions },
  ];

  const featureValue = (f: FeatureRow): string => {
    if (f.limit <= 0) return "Not included";
    return `${formatUsagePercent((f.used / f.limit) * 100)} used`;
  };

  const monthLabel = usage.monthResetAt
    ? new Date(usage.monthResetAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : "monthly";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <div style={labelStyle}>5-Hour Usage</div>
        <Bar pct={pct5h} />
        <div style={subStyle}>
          {formatUsagePercent(pct5h)} used
        </div>
        <div style={{ ...subStyle, marginTop: 2 }}>
          {open5h && reset5h
            ? `Resets in ${formatHrMin(reset5h - now)}`
            : "Window resets 5 hours after your first message"}
        </div>
      </div>

      <div>
        <div style={labelStyle}>This Week</div>
        <Bar pct={pctWeek} />
        <div style={subStyle}>
          {formatUsagePercent(pctWeek)} used
        </div>
        <div style={{ ...subStyle, marginTop: 2 }}>
          {openWeek && resetWeek
            ? `Resets in ${formatDaysHr(resetWeek - now)}`
            : "Weekly window resets on your next message"}
        </div>
      </div>

      <div>
        <div style={{ ...labelStyle, marginBottom: 2 }}>Monthly Usage</div>
        <div style={{ ...subStyle, marginBottom: 12 }}>Resets {monthLabel}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {features.map((f) => {
            const pct = f.limit ? (f.used / f.limit) * 100 : 0;
            return (
              <div key={f.label}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{f.label}</span>
                  <span style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                    {featureValue(f)}
                  </span>
                </div>
                <Bar pct={pct} />
              </div>
            );
          })}
        </div>
      </div>

      <TokenInfoBox />
    </div>
  );
}

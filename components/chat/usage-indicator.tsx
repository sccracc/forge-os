"use client";

import { useRouter } from "next/navigation";
import { useUsageStore } from "@/lib/store/usage-store";
import { tokenStatus, indicatorLevel, formatHrMin, formatDaysHr } from "@/lib/usage/compute";

/**
 * Small token-usage indicator shown next to the model selector once usage passes
 * 80%. <80% renders nothing; 80-94% amber, 95-99% orange ("X% remaining"); at
 * 100% red ("Window full · resets in …"). Clicking opens the settings usage view.
 */
export function UsageIndicator() {
  const router = useRouter();
  const usage = useUsageStore((s) => s.usage);
  const plan = useUsageStore((s) => s.plan);

  if (!usage) return null;
  const status = tokenStatus(plan, usage);
  const level = indicatorLevel(status.pctRaw);
  if (level === "hidden") return null;

  let text: string;
  if (level === "full") {
    const ms = status.resetsAt ? status.resetsAt - Date.now() : 0;
    const dur = status.blocking === "weekly" ? formatDaysHr(ms) : formatHrMin(ms);
    text = status.resetsAt && ms > 0 ? `Window full · resets in ${dur}` : "Window full";
  } else {
    text = `${status.remaining}% remaining`;
  }

  return (
    <button
      type="button"
      className={`usage-indicator ${level}`}
      onClick={() => router.push("/settings#usage")}
      title="View usage details"
    >
      {text}
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useUsageStore } from "@/lib/store/usage-store";
import { formatHrMin, formatDaysHr } from "@/lib/usage/compute";
import { resolvePlanId } from "@/lib/plans/limits";

// Per-plan upsell shown beneath the countdown (§STEP 5). Ultra = none.
const UPGRADE: Record<string, { blurb: string; cta: string } | null> = {
  free: {
    blurb: "Upgrade to Starter for 150,000 tokens per 5-hour window and unlock more features.",
    cta: "Upgrade to Starter — $10/month",
  },
  starter: {
    blurb: "Upgrade to Pro for 500,000 tokens per 5-hour window and unlock both chat models.",
    cta: "Upgrade to Pro — $20/month",
  },
  pro: {
    blurb: "Upgrade to Max for 1,250,000 tokens per 5-hour window, Max effort, and Forge Image Pro.",
    cta: "Upgrade to Max — $50/month",
  },
  max: {
    blurb: "Upgrade to Ultra for 2,500,000 tokens per 5-hour window.",
    cta: "Upgrade to Ultra — $100/month",
  },
  ultra: null,
};

/**
 * Shown when the chat API returns a 429 usage_limit. Daily limits show a static
 * "resets at midnight UTC"; rolling windows show a live countdown that ticks
 * every second. Includes a plan-appropriate upgrade prompt.
 */
export function UsageLimitModal() {
  const limit = useUsageStore((s) => s.limit);
  const plan = useUsageStore((s) => s.plan);
  const close = useUsageStore((s) => s.closeLimit);
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!limit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [limit, close]);

  useEffect(() => {
    if (!limit?.resetsAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [limit?.resetsAt]);

  if (!mounted || !limit) return null;

  const isDaily = limit.reason === "daily_limit";
  const ms = limit.resetsAt ? limit.resetsAt - Date.now() : 0;
  const countdown = limit.reason === "weekly" ? formatDaysHr(ms) : formatHrMin(ms);
  const upgrade = UPGRADE[resolvePlanId(plan)];

  const goBilling = () => {
    close();
    router.push("/settings#billing");
  };

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-label="Usage Limit Reached">
        <h3 className="confirm-title">Usage Limit Reached</h3>
        {limit.message && <p className="confirm-message">{limit.message}</p>}
        <div className="usage-reset">
          {isDaily ? (
            "Your daily tokens reset at midnight UTC"
          ) : limit.resetsAt && ms > 0 ? (
            <>
              Resets in <strong>{countdown}</strong>
            </>
          ) : (
            "Your window has reset — try again"
          )}
        </div>

        {upgrade && (
          <div className="usage-upgrade">
            <p>{upgrade.blurb}</p>
            <button className="btn-amber" style={{ width: "100%" }} onClick={goBilling}>
              {upgrade.cta}
            </button>
          </div>
        )}

        <div className="confirm-actions">
          <button className="btn-ghost" style={{ flex: 1 }} onClick={close} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

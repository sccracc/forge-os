"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useUsageStore } from "@/lib/store/usage-store";
import { PLAN_NAMES } from "@/lib/plans/gates";
import { resolvePlanId } from "@/lib/plans/limits";

/**
 * "Feature Locked" modal shown when any API returns a 403 plan_gate. Offers an
 * upgrade path to /settings#billing (Stripe wiring comes in the final step).
 */
export function PlanGateModal() {
  const gate = useUsageStore((s) => s.gate);
  const close = useUsageStore((s) => s.closeGate);
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!gate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gate, close]);

  if (!mounted || !gate) return null;

  const planName = gate.requiredPlan ? PLAN_NAMES[resolvePlanId(gate.requiredPlan)] : null;
  const title = gate.feature === "forge_code" ? "Forge Code" : "Feature Locked";
  const messageHasPlan = /available on|plan/i.test(gate.message ?? "");
  const goBilling = () => {
    close();
    router.push("/settings#billing");
  };

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="confirm-modal plan-gate-modal" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="confirm-icon">
          <Lock size={20} />
        </div>
        <h3 className="confirm-title">{title}</h3>
        {gate.message && <p className="confirm-message">{gate.message}</p>}
        {planName && !messageHasPlan && (
          <div className="usage-reset">
            Available on <strong>{planName}</strong> and above
          </div>
        )}
        <div className="confirm-actions">
          <button className="btn-ghost" style={{ flex: 1 }} onClick={close}>
            Maybe later
          </button>
          <button className="btn-amber" style={{ flex: 1 }} onClick={goBilling} autoFocus>
            Upgrade
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

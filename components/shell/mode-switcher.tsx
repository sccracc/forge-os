"use client";

import { useRouter, usePathname } from "next/navigation";
import { MessagesSquare, Code2, Lock } from "lucide-react";
import { useUIStore } from "@/lib/store/ui-store";
import { usePlan } from "@/lib/plans/use-plan";
import { canUseForgeCode, getRequiredPlan, getUpgradeMessage } from "@/lib/plans/gates";
import { useUsageStore } from "@/lib/store/usage-store";

export function ModeSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const isCode = pathname.startsWith("/code");
  const setMode = useUIStore((s) => s.setMode);
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const openGate = useUsageStore((s) => s.openGate);
  const plan = usePlan();
  const codeLocked = !canUseForgeCode(plan);

  const go = (code: boolean) => {
    if (code && codeLocked) {
      setMobileSidebarOpen(false);
      openGate({
        feature: "forge_code",
        message: getUpgradeMessage(plan, "Forge Code"),
        requiredPlan: getRequiredPlan("Forge Code"),
      });
      return;
    }
    const navigate = () => {
      setMode(code ? "code" : "chat");
      setMobileSidebarOpen(false);
      router.push(code ? "/code" : "/");
    };
    // #43 · Depth trade — when the browser supports View Transitions, the whole
    // workspace trades depth (old recedes, new arrives; styled in globals.css).
    // Navigation is identical either way — the API only wraps the same calls.
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(navigate);
    } else {
      navigate();
    }
  };

  return (
    <div className="segmented" role="tablist" aria-label="Workspace mode">
      <div
        className="seg-thumb"
        style={{
          left: isCode ? "calc(50% + 1px)" : "3px",
          right: isCode ? "3px" : "calc(50% + 1px)",
          transition:
            "left .3s cubic-bezier(.34,1.56,.64,1), right .3s cubic-bezier(.34,1.56,.64,1)",
        }}
      />
      <button
        className={isCode ? "" : "active"}
        onClick={() => go(false)}
        role="tab"
        aria-selected={!isCode}
      >
        <MessagesSquare /> Chat
      </button>
      <button
        className={isCode ? "active" : ""}
        onClick={() => go(true)}
        role="tab"
        aria-selected={isCode}
        title={codeLocked ? "Forge Code is available on Pro and above" : undefined}
      >
        <Code2 /> Code
        {codeLocked && <Lock size={10} style={{ marginLeft: 4, opacity: 0.7 }} />}
      </button>
    </div>
  );
}

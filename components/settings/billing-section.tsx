"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { toast } from "@/lib/store/toast-store";
import { useUsageStore } from "@/lib/store/usage-store";
import { usePlan } from "@/lib/plans/use-plan";
import { resolvePlanId, type PlanId } from "@/lib/plans/limits";

// Monthly Stripe Price IDs by plan (public, inlined at build).
const PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID,
  pro: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
  max: process.env.NEXT_PUBLIC_STRIPE_MAX_PRICE_ID,
  ultra: process.env.NEXT_PUBLIC_STRIPE_ULTRA_PRICE_ID,
};

const RANK: Record<PlanId, number> = { free: 0, starter: 1, pro: 2, max: 3, ultra: 4 };

interface PlanCardData {
  id: PlanId;
  name: string;
  price: number;
  tagline: string;
  badge?: "popular" | "value";
  highlights: string[];
  all: string[];
}

const PLANS: PlanCardData[] = [
  {
    id: "free",
    name: "Forge Free",
    price: 0,
    tagline: "Get a feel for Forge.",
    highlights: ["7,500 tokens/day", "Spark 2.5", "Low & Medium effort", "Artifacts", "3 document uploads"],
    all: [
      "7,500 tokens/day",
      "Spark 2.5 only",
      "Low, Medium effort",
      "Artifacts",
      "3 document uploads (stored)",
      "Community support",
    ],
  },
  {
    id: "starter",
    name: "Forge Starter",
    price: 10,
    tagline: "Everyday AI, more power.",
    highlights: [
      "150K tokens / 5-hour window",
      "Spark 2.5 + High effort",
      "Thinking (Spark)",
      "Unlimited skills",
      "Forge Image, vision & web search",
      "45 min voice input",
    ],
    all: [
      "150,000 tokens / 5-hour window",
      "750,000 tokens / week",
      "Spark 2.5, up to High effort",
      "Thinking on Spark (2× usage)",
      "Unlimited skills · Basic memory",
      "Artifacts",
      "Forge Image 20/mo · Vision 30/mo",
      "Web search 50/mo · 20 doc uploads/mo",
      "Voice input 45 min/mo",
      "Email support (72hr)",
    ],
  },
  {
    id: "pro",
    name: "Forge Pro",
    price: 20,
    tagline: "The full Forge workspace.",
    badge: "popular",
    highlights: [
      "500K tokens / 5-hour window",
      "Spark 2.5 + Magnum 2.8",
      "Forge Code + file system",
      "20 projects",
      "Forge Image + voice in/out",
      "MCP + Google Workspace",
    ],
    all: [
      "500,000 tokens / 5-hour window",
      "2,500,000 tokens / week",
      "Spark 2.5 + Magnum 2.8 (5× / 10×)",
      "Up to Extra High effort · Thinking on both",
      "Forge Code (Magnum in Build) · File system",
      "20 projects · Unlimited skills · Better memory",
      "Document generation · Conversation branching",
      "Forge Image 60/mo · Vision 180/mo",
      "Web search 400/mo · 80 doc uploads/mo",
      "Code execution 40/mo",
      "Voice input 250 min · Voice output 40,000 chars",
      "10GB storage · 3 MCP connectors",
      "Google Workspace (partial) · Email support (24hr)",
    ],
  },
  {
    id: "max",
    name: "Forge Max",
    price: 50,
    tagline: "For power users & builders.",
    badge: "value",
    highlights: [
      "1.25M tokens / 5-hour window",
      "Max effort, unrestricted thinking",
      "50 projects",
      "API access (beta)",
      "White-label exports",
      "Forge Image Pro",
    ],
    all: [
      "1,250,000 tokens / 5-hour window",
      "6,000,000 tokens / week",
      "Both models · All effort incl. Max",
      "Fully unrestricted thinking",
      "Forge Code · File system · 50 projects",
      "Full memory (edit/delete) · Unlimited skills",
      "White-label exports · Zapier/Make · Early access",
      "Forge Image Pro 250/mo · Vision 400/mo",
      "Web search 1,500/mo · 300 doc uploads/mo",
      "Code execution 300/mo",
      "Voice input 500 min · Voice output 100,000 chars",
      "50GB storage · Unlimited MCP",
      "Google Workspace (full, Gmail send)",
      "API access (beta 500K/mo) · Support (12hr)",
    ],
  },
  {
    id: "ultra",
    name: "Forge Ultra",
    price: 100,
    tagline: "Everything, no limits.",
    highlights: [
      "2.5M tokens / 5-hour window",
      "Unlimited projects",
      "Full API (5M tokens)",
      "Team seats",
      "Forge Image Pro",
      "Priority support",
    ],
    all: [
      "2,500,000 tokens / 5-hour window",
      "12,000,000 tokens / week",
      "Both models · All effort · Zero restrictions",
      "Forge Code · File system · Unlimited projects",
      "Full memory + custom skill library",
      "White-label exports · Full Zapier/Make automation",
      "Team seats ($60/seat/mo add-on) · Monthly usage report",
      "Forge Image Pro 600/mo · Vision 800/mo",
      "Web search 3,000/mo · 1,000 doc uploads/mo",
      "Code execution 600/mo",
      "Voice input 600 min · Voice output 300,000 chars",
      "200GB storage · Unlimited MCP",
      "Google Workspace (full, unrestricted)",
      "API access (full 5M/mo) · Private Slack/Discord (4hr)",
    ],
  },
];

const COMPARISON: { label: string; values: [string, string, string, string, string] }[] = [
  { label: "Token window", values: ["7.5K/day", "150K / 5h", "500K / 5h", "1.25M / 5h", "2.5M / 5h"] },
  { label: "Weekly token window", values: ["—", "750K", "2.5M", "6M", "12M"] },
  { label: "Token multipliers", values: ["1×, 2×", "1×, 2×", "1×–10×", "1×–10×", "1×–10×"] },
  { label: "Models available", values: ["Spark 2.5", "Spark 2.5", "Both", "Both", "Both"] },
  { label: "Image model", values: ["—", "Forge Image", "Forge Image", "Forge Image Pro", "Forge Image Pro"] },
  { label: "Max effort level", values: ["Medium", "High", "Extra High", "Max", "Max"] },
  { label: "Thinking mode", values: ["—", "Spark only", "Both", "Unrestricted", "Unrestricted"] },
  { label: "Forge Code", values: ["—", "—", "✓", "✓", "✓"] },
  { label: "File system", values: ["—", "—", "✓", "✓", "✓"] },
  { label: "Projects", values: ["—", "—", "20", "50", "Unlimited"] },
  { label: "Skills", values: ["—", "Unlimited", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "Memory", values: ["—", "Basic", "Better", "Full", "Full +"] },
  { label: "Artifacts", values: ["✓", "✓", "✓", "✓", "✓"] },
  { label: "Image generations / month", values: ["—", "20", "60", "250", "600"] },
  { label: "Image understanding / month", values: ["—", "30", "180", "400", "800"] },
  { label: "Document uploads / month", values: ["3", "20", "80", "300", "1,000"] },
  { label: "Web search / month", values: ["—", "50", "400", "1,500", "3,000"] },
  { label: "Code execution / month", values: ["—", "—", "40", "300", "600"] },
  { label: "Voice input / month", values: ["—", "45 min", "250 min", "500 min", "600 min"] },
  { label: "Voice output / month", values: ["—", "—", "40K chars", "100K chars", "300K chars"] },
  { label: "Storage", values: ["—", "—", "10GB", "50GB", "200GB"] },
  { label: "MCP connectors", values: ["—", "—", "3", "Unlimited", "Unlimited"] },
  { label: "Google Workspace", values: ["—", "—", "Partial", "Full", "Full"] },
  { label: "API access", values: ["—", "—", "—", "Beta 500K", "Full 5M"] },
  { label: "Support", values: ["Community", "Email 72hr", "Email 24hr", "Dedicated 12hr", "Slack 4hr"] },
];

function CurrentPlanCard({
  plan,
  onManage,
  managing,
}: {
  plan: PlanId;
  onManage: () => void;
  managing: boolean;
}) {
  const data = PLANS.find((p) => p.id === plan)!;

  return (
    <div className="billing-current">
      <div className="bc-head">
        <div>
          <div className="bc-label">Your current plan</div>
          <div className="bc-name">
            {data.name} <span className="bc-price">${data.price}/mo</span>
          </div>
          <p className="bc-note">{data.tagline}</p>
        </div>
        {plan !== "free" && (
          <button className="btn-ghost" onClick={onManage} disabled={managing}>
            {managing ? "Opening…" : "Manage Billing"}
          </button>
        )}
      </div>
    </div>
  );
}

export function BillingSection() {
  const { getIdToken } = useAuth();
  const plan = resolvePlanId(usePlan());
  const refresh = useUsageStore((s) => s.refresh);
  const [showCompare, setShowCompare] = useState(false);
  const [expanded, setExpanded] = useState<PlanId | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openPortal = async () => {
    setManaging(true);
    try {
      const token = await getIdToken();
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !data?.url) throw new Error(data?.error || "Couldn't open the billing portal.");
      window.location.assign(data.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the billing portal.");
      setManaging(false);
    }
  };

  // Free users start a new Checkout; existing subscribers change plans in the
  // Stripe portal (avoids creating a duplicate subscription).
  const handleUpgrade = async (planId: string) => {
    setLoadingPlan(planId);
    try {
      const token = await getIdToken();
      if (plan !== "free") {
        const res = await fetch("/api/stripe/portal", {
          method: "POST",
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
        });
        const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!res.ok || !data?.url) throw new Error(data?.error || "Couldn't open the billing portal.");
        window.location.assign(data.url);
        return;
      }
      const priceId = PRICE_ENV[planId];
      if (!priceId) throw new Error("This plan isn't available yet. Check back soon.");
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ priceId, billingPeriod: "monthly" }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !data?.url) throw new Error(data?.error || "Couldn't start checkout.");
      window.location.assign(data.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout.");
      setLoadingPlan(null);
    }
  };

  return (
    <div className="billing">
      <CurrentPlanCard plan={plan} onManage={openPortal} managing={managing} />

      <div className="plan-cards">
        {PLANS.map((p) => {
          const isCurrent = p.id === plan;
          const isUpgrade = RANK[p.id] > RANK[plan];
          const busy = loadingPlan === p.id;
          return (
            <div key={p.id} className={`plan-card ${isCurrent ? "current" : ""}`}>
              {p.badge === "popular" && <span className="plan-badge popular">Most popular</span>}
              {p.badge === "value" && <span className="plan-badge value">Best value</span>}

              <div className="plan-card-name">{p.name}</div>
              <div className="plan-card-price">
                <span className="pcp-amount">${p.price}</span>
                <span className="pcp-period">/mo</span>
              </div>
              <div className="plan-card-billed">{p.id === "free" ? "Free forever" : p.tagline}</div>

              {expanded === p.id ? (
                <ul className="plan-card-feats">
                  {p.all.map((f) => (
                    <li key={f}>
                      <Check size={14} /> {f}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="plan-card-feats">
                  {p.highlights.map((f) => (
                    <li key={f}>
                      <Check size={14} /> {f}
                    </li>
                  ))}
                </ul>
              )}

              <button
                className="plan-card-more"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              >
                {expanded === p.id ? "Show less" : "See all features"}
                <ChevronDown
                  size={13}
                  style={{
                    transform: expanded === p.id ? "rotate(180deg)" : "none",
                    transition: "transform .18s",
                  }}
                />
              </button>

              <div className="plan-card-cta">
                {isCurrent ? (
                  <button className="pcc-current" disabled>
                    Current Plan
                  </button>
                ) : isUpgrade ? (
                  <button
                    className="btn-amber"
                    onClick={() => handleUpgrade(p.id)}
                    disabled={loadingPlan !== null || managing}
                  >
                    {busy ? "Redirecting…" : `Upgrade to ${p.name.replace("Forge ", "")}`}
                  </button>
                ) : (
                  <button
                    className="pcc-downgrade"
                    onClick={() => handleUpgrade(p.id)}
                    disabled={loadingPlan !== null || managing}
                  >
                    {busy ? "Redirecting…" : "Downgrade"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className="compare-toggle" onClick={() => setShowCompare((s) => !s)}>
        {showCompare ? "Hide comparison" : "Compare all plans"}
        <ChevronDown
          size={14}
          style={{ transform: showCompare ? "rotate(180deg)" : "none", transition: "transform .18s" }}
        />
      </button>

      {showCompare && (
        <div className="compare-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                {PLANS.map((p) => (
                  <th key={p.id} className={p.id === plan ? "col-current" : ""}>
                    {p.name.replace("Forge ", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label}>
                  <td className="row-label">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className={PLANS[i].id === plan ? "col-current" : ""}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

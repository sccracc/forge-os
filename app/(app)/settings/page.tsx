"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sun, Moon, Monitor, LogOut, Trash2, Download } from "lucide-react";
import { SimpleTopbar } from "@/components/shell/topbar";
import { useAuth } from "@/components/auth/auth-provider";
import { useUIStore } from "@/lib/store/ui-store";
import { useConversations } from "@/hooks/use-conversations";
import { updateProfile } from "@/lib/data/profile";
import { deleteConversation } from "@/lib/data/chat";
import { exportAllData } from "@/lib/export";
import { FORGE_MODELS_PUBLIC, FORGE_MODEL_IDS, type ForgeModelId } from "@/lib/ai/models.public";
import { EFFORT, EFFORT_IDS, type EffortId } from "@/lib/ai/effort";
import { toast } from "@/lib/store/toast-store";
import { confirm } from "@/lib/store/confirm-store";
import { UsageSection } from "@/components/settings/usage-section";
import { BillingSection } from "@/components/settings/billing-section";
import { invalidate } from "@/lib/data/realtime";
import { useUsageStore } from "@/lib/store/usage-store";
import type { ThemePref } from "@/lib/theme";

function Card({
  title,
  desc,
  children,
  id,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "20px 22px",
        marginBottom: 18,
        scrollMarginTop: 16,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: desc ? 4 : 14 }}>{title}</h2>
      {desc && <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginBottom: 16 }}>{desc}</p>}
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "11px 0",
        borderTop: "1px solid var(--border)",
        gap: 16,
        // Fixed-width selects wrap below the label on narrow phones instead
        // of overflowing the card (mobile audit).
        flexWrap: "wrap",
        rowGap: 8,
      }}
    >
      <span style={{ fontSize: 14 }}>{label}</span>
      {children}
    </div>
  );
}

const THEMES: { id: ThemePref; label: string; icon: React.ReactNode }[] = [
  { id: "light", label: "Light", icon: <Sun size={15} /> },
  { id: "dark", label: "Dark", icon: <Moon size={15} /> },
  { id: "system", label: "System", icon: <Monitor size={15} /> },
];

export default function SettingsPage() {
  const { user, profile, signOutUser, getIdToken } = useAuth();
  const router = useRouter();
  const upgradeHandled = useRef(false);
  const themePref = useUIStore((s) => s.themePref);
  const setThemePref = useUIStore((s) => s.setThemePref);
  const { conversations } = useConversations();

  const [about, setAbout] = useState("");
  const [style, setStyle] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [savingPers, setSavingPers] = useState(false);
  const [savingMem, setSavingMem] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (profile) {
      setAbout(profile.customAbout || "");
      setStyle(profile.customStyle || "");
      setMemoryText(profile.memoryProfile || "");
    }
  }, [profile]);

  // Post-Stripe-checkout / portal return: clear the query params and refresh plan.
  useEffect(() => {
    if (upgradeHandled.current || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const upgraded = sp.get("upgraded") === "true";
    const billingSync = sp.get("billing_sync") === "true";
    if (!upgraded && !billingSync) return;
    upgradeHandled.current = true;
    if (upgraded) {
      const raw = (sp.get("plan") || "").trim();
      const planName = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "your new plan";
      toast.success(`🎉 Welcome to ${planName}! Your new features are now unlocked.`);
    }
    if (user) {
      // Don't rely on the Stripe webhook (easy to misconfigure) — reconcile the
      // plan directly from Stripe on return, then refresh the UI. This activates
      // the plan even when the webhook never fires.
      void (async () => {
        try {
          const token = await getIdToken();
          await fetch("/api/stripe/sync", {
            method: "POST",
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
          });
        } catch {
          /* best-effort — webhook is the fallback */
        }
        invalidate(`profile:${user.uid}`);
        void useUsageStore.getState().refresh();
        // Again shortly after, in case the webhook also lands a moment later.
        setTimeout(() => {
          invalidate(`profile:${user.uid}`);
          void useUsageStore.getState().refresh();
        }, 3500);
      })();
    }
    router.replace("/settings");
  }, [user, router, getIdToken]);

  // Deep-link to a section (e.g. /settings#data from the account menu).
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const t = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(t);
  }, []);

  if (!user) return null;

  const patch = (p: Parameters<typeof updateProfile>[1]) =>
    updateProfile(user.uid, p).catch(() => toast.error("Couldn't save"));

  const savePersonalization = async () => {
    setSavingPers(true);
    await patch({ customAbout: about, customStyle: style });
    setSavingPers(false);
    toast.success("Personalization saved");
  };

  const saveMemory = async () => {
    setSavingMem(true);
    await patch({ memoryProfile: memoryText });
    setSavingMem(false);
    toast.success("Memory saved");
  };

  const clearAllChats = async () => {
    if (
      !(await confirm({
        title: `Delete all ${conversations.length} chats?`,
        message: "Every conversation will be permanently deleted. This can't be undone.",
        confirmLabel: "Delete all",
      }))
    )
      return;
    await Promise.all(conversations.map((c) => deleteConversation(user.uid, c.id).catch(() => {})));
    toast.success("All chats cleared");
  };

  const downloadAll = async () => {
    setExporting(true);
    try {
      await exportAllData(user.uid);
      toast.success("Export ready");
    } catch {
      toast.error("Couldn't export your data");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <SimpleTopbar title="Settings" />
      <div className="content-area">
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 24px" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {/* Appearance */}
            <Card title="Appearance" desc="Choose how Forge looks. Light is the default.">
              <div style={{ display: "flex", gap: 10 }}>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setThemePref(t.id)}
                    className={themePref === t.id ? "btn-amber" : "btn-ghost"}
                    style={{ flex: 1, justifyContent: "center" }}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </Card>

            {/* Usage */}
            <Card
              title="Usage"
              id="usage"
              desc="Your Forge token windows and monthly feature usage."
            >
              <UsageSection />
            </Card>
          </div>

          {/* Plan & Billing — wider column so the plan cards have room to breathe */}
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <section id="billing" style={{ scrollMarginTop: 16, marginBottom: 18 }}>
              <h2 style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Plan &amp; Billing</h2>
              <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 22 }}>
                Choose the plan that fits how you use Forge.
              </p>
              <BillingSection />
            </section>
          </div>

          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {/* Defaults */}
            <Card title="Defaults" desc="Applied to new conversations.">
              <Row label="Default model">
                <select
                  className="field"
                  style={{ width: "min(200px, 100%)", padding: "8px 10px", margin: 0 }}
                  value={profile?.defaultModel ?? "magnum-2.8"}
                  onChange={(e) => patch({ defaultModel: e.target.value as ForgeModelId })}
                >
                  {FORGE_MODEL_IDS.map((id) => (
                    <option key={id} value={id}>
                      {FORGE_MODELS_PUBLIC[id].label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Default effort">
                <select
                  style={{
                    width: "min(200px, 100%)",
                    padding: "8px 10px",
                    background: "var(--bg-elev)",
                    border: "1px solid var(--border-bright)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text)",
                    fontFamily: "inherit",
                    fontSize: 14,
                  }}
                  value={profile?.defaultEffort ?? "low"}
                  onChange={(e) => patch({ defaultEffort: e.target.value as EffortId })}
                >
                  {EFFORT_IDS.map((id) => (
                    <option key={id} value={id}>
                      {EFFORT[id].label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Thinking on by default">
                <button
                  className={`switch ${profile?.defaultThinking ? "on" : ""}`}
                  onClick={() => patch({ defaultThinking: !profile?.defaultThinking })}
                  aria-pressed={profile?.defaultThinking}
                />
              </Row>
              <Row label="Tools on by default">
                <button
                  className={`switch ${profile?.defaultToolsEnabled ? "on" : ""}`}
                  onClick={() => patch({ defaultToolsEnabled: !profile?.defaultToolsEnabled })}
                  aria-pressed={profile?.defaultToolsEnabled}
                />
              </Row>
            </Card>

            {/* Forge Code build agent */}
            <Card title="Forge Code build agent" desc="How much the build agent does on its own. It always plans, builds, verifies it works, and fixes its own errors — this controls whether it pauses for you.">
              <Row label="Autonomy">
                <select
                  style={{
                    width: "min(250px, 100%)",
                    padding: "8px 10px",
                    background: "var(--bg-elev)",
                    border: "1px solid var(--border-bright)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text)",
                    fontFamily: "inherit",
                    fontSize: 14,
                  }}
                  value={profile?.buildAutonomy ?? "auto"}
                  onChange={(e) => patch({ buildAutonomy: e.target.value as "auto" | "plan" | "step" })}
                >
                  <option value="auto">Autonomous — just build it</option>
                  <option value="plan">Show the plan, then build</option>
                  <option value="step">Approve before building</option>
                </select>
              </Row>
            </Card>

            {/* Personalization */}
            <Card
              title="Personalization"
              desc="These are added to Forge's instructions on every conversation."
            >
              <div className="field">
                <label>What should Forge know about you?</label>
                <textarea
                  value={about}
                  onChange={(e) => setAbout(e.target.value)}
                  placeholder="Your role, projects, the tools and stack you use…"
                />
              </div>
              <div className="field">
                <label>How should Forge respond?</label>
                <textarea
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="Tone, format, level of detail you prefer…"
                />
              </div>
              <button className="btn-amber" onClick={savePersonalization} disabled={savingPers}>
                {savingPers ? "Saving…" : "Save personalization"}
              </button>
            </Card>

            {/* Memory */}
            <Card title="Memory & history" desc="Control what Forge remembers across conversations.">
              <Row label="Generate memory from chat history">
                <button
                  className={`switch ${profile?.memoryEnabled ? "on" : ""}`}
                  onClick={() => patch({ memoryEnabled: !profile?.memoryEnabled })}
                  aria-pressed={profile?.memoryEnabled}
                />
              </Row>
              <Row label="Search & reference past chats">
                <button
                  className={`switch ${profile?.searchChatsEnabled ? "on" : ""}`}
                  onClick={() => patch({ searchChatsEnabled: !profile?.searchChatsEnabled })}
                  aria-pressed={profile?.searchChatsEnabled}
                />
              </Row>
              <div className="field" style={{ marginTop: 16, marginBottom: 12 }}>
                <label>Memory profile</label>
                <textarea
                  value={memoryText}
                  onChange={(e) => setMemoryText(e.target.value)}
                  placeholder="Forge will fill this in as you chat. You can edit it anytime."
                  style={{ minHeight: 120 }}
                />
                <div className="hint">Durable facts Forge keeps about you and your work.</div>
              </div>
              <button className="btn-amber" onClick={saveMemory} disabled={savingMem}>
                {savingMem ? "Saving…" : "Save memory"}
              </button>
            </Card>

            {/* Data & account */}
            <Card title="Data & account" id="data">
              <Row label="Download all my data">
                <button className="btn-ghost" onClick={downloadAll} disabled={exporting}>
                  <Download size={14} /> {exporting ? "Preparing…" : "Export .zip"}
                </button>
              </Row>
              <Row label={`Clear all chats (${conversations.length})`}>
                <button className="btn-ghost" onClick={clearAllChats} disabled={conversations.length === 0}>
                  <Trash2 size={14} /> Clear
                </button>
              </Row>
              <Row label="Sign out">
                <button className="btn-ghost" onClick={() => signOutUser()}>
                  <LogOut size={14} /> Sign out
                </button>
              </Row>
            </Card>

            <div style={{ height: 40 }} />
          </div>
        </div>
      </div>
    </>
  );
}

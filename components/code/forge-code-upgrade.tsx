"use client";

import { useRouter } from "next/navigation";
import { Code2, Check } from "lucide-react";

const FEATURES = [
  "Full IDE with file explorer",
  "Live preview for HTML, React, Vue, Python",
  "AI builds your projects with Magnum 2.8",
  "Real-time file diff tracking",
  "Download and publish your projects",
];

/** Full-page upgrade prompt shown to free/starter users in place of Forge Code. */
export function ForgeCodeUpgrade() {
  const router = useRouter();
  return (
    <div className="forge-code-upgrade">
      <div className="fcu-card">
        <div className="fcu-icon">
          <Code2 size={28} />
        </div>
        <h1>Forge Code is available on Pro and above</h1>
        <p>Build, preview, and ship real projects with an AI that writes the code for you.</p>
        <ul className="fcu-features">
          {FEATURES.map((f) => (
            <li key={f}>
              <Check size={16} /> {f}
            </li>
          ))}
        </ul>
        <button className="btn-amber fcu-cta" onClick={() => router.push("/settings#billing")}>
          Upgrade to Pro
        </button>
        <button className="fcu-link" onClick={() => router.push("/settings#billing")}>
          See all plans
        </button>
      </div>
    </div>
  );
}

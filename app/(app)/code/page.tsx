"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, FileCode2 } from "lucide-react";
import { SimpleTopbar } from "@/components/shell/topbar";
import { NewProjectModal } from "@/components/code/new-project-modal";
import { useAuth } from "@/components/auth/auth-provider";
import { useProjects } from "@/hooks/use-projects";
import { deleteProject } from "@/lib/data/projects";
import { relativeTime } from "@/lib/utils";
import { toast } from "@/lib/store/toast-store";
import { confirm } from "@/lib/store/confirm-store";
import { usePlan } from "@/lib/plans/use-plan";
import { canUseForgeCode, getProjectLimit, PLAN_NAMES } from "@/lib/plans/gates";
import { resolvePlanId } from "@/lib/plans/limits";
import { useUsageStore } from "@/lib/store/usage-store";
import { ForgeCodeUpgrade } from "@/components/code/forge-code-upgrade";
import type { ProjectDoc } from "@/lib/data/types";

export default function CodeGalleryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { projects, loading } = useProjects();
  const [creating, setCreating] = useState(false);
  const plan = usePlan();
  const codeLocked = !canUseForgeCode(plan);
  const projectLimit = getProjectLimit(plan);
  const atProjectLimit = projectLimit !== null && projects.length >= projectLimit;

  const newProject = () => {
    if (atProjectLimit) {
      const next = plan === "pro" ? "max" : plan === "max" ? "ultra" : undefined;
      useUsageStore.getState().openGate({
        feature: "projects",
        message: `You've reached your ${PLAN_NAMES[resolvePlanId(plan)]} plan limit of ${projectLimit} projects.`,
        requiredPlan: next,
      });
      return;
    }
    setCreating(true);
  };

  const remove = async (e: React.MouseEvent, p: ProjectDoc) => {
    e.stopPropagation();
    if (!user) return;
    if (
      !(await confirm({
        title: `Delete “${p.name}”?`,
        message: "The project and all of its files will be permanently deleted.",
        confirmLabel: "Delete",
      }))
    )
      return;
    await deleteProject(user.uid, p.id);
    toast.success("Project deleted");
  };

  if (codeLocked) {
    return (
      <>
        <SimpleTopbar title="Forge Code" />
        <div className="content-area">
          <ForgeCodeUpgrade />
        </div>
      </>
    );
  }

  return (
    <>
      <SimpleTopbar title="Forge Code" />
      <div className="content-area">
        <div style={{ flex: 1, overflowY: "auto", padding: "40px 28px" }}>
          <div style={{ maxWidth: 980, margin: "0 auto" }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>Forge Code</h1>
            <p style={{ color: "var(--text-dim)", fontSize: 15, marginBottom: 28 }}>
              Build, preview, and ship projects in any language — no setup.
            </p>

            <div className="project-grid">
              <button className="new-project-card" onClick={newProject}>
                <div className="npc-icon">
                  <Plus size={24} />
                </div>
                New Project
              </button>

              {loading && projects.length === 0
                ? [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 196, borderRadius: 16 }} />)
                : projects.map((p) => (
                    <button key={p.id} className="project-card" onClick={() => router.push(`/code/${p.id}`)}>
                      <div
                        className="project-thumb"
                        style={{ background: `linear-gradient(135deg, ${p.gradient?.[0] ?? "#ff7a1a"}, ${p.gradient?.[1] ?? "#c2470a"})` }}
                      >
                        <FileCode2 size={30} />
                        <span
                          className="project-del"
                          onClick={(e) => remove(e, p)}
                          role="button"
                          aria-label="Delete project"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </span>
                      </div>
                      <div className="project-meta">
                        <div className="project-name">{p.name}</div>
                        <div className="project-sub">
                          <span className="lang-dot" /> {p.language} · {p.fileCount} file
                          {p.fileCount === 1 ? "" : "s"} · {relativeTime(p.updatedAt)}
                        </div>
                      </div>
                    </button>
                  ))}
            </div>

            {!loading && projects.length === 0 && (
              <p style={{ marginTop: 28, textAlign: "center", color: "var(--text-faint)", fontSize: 13.5, lineHeight: 1.7 }}>
                Your projects appear here, sharing the same files and account as Forge Chat.
              </p>
            )}
          </div>
        </div>
      </div>
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </>
  );
}

"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Download, Share2, Loader2, History } from "lucide-react";
import { TopbarFrame } from "@/components/shell/topbar";
import { IDE } from "@/components/code/ide";
import { CheckpointsModal } from "@/components/code/checkpoints-modal";
import { useAuth } from "@/components/auth/auth-provider";
import { useProject, useProjectFiles } from "@/hooks/use-projects";
import { updateProject } from "@/lib/data/projects";
import { downloadProjectZip, publishProject, publishedUrl } from "@/lib/code/export";
import { effectivePreviewMode } from "@/lib/code/preview";
import { toast } from "@/lib/store/toast-store";
import { burstConfetti } from "@/lib/confetti";
import { SuccessCheck } from "@/components/ui/success-check";
import { usePlan } from "@/lib/plans/use-plan";
import { canUseForgeCode } from "@/lib/plans/gates";
import { ForgeCodeUpgrade } from "@/components/code/forge-code-upgrade";

export default function ProjectIDEPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { user } = useAuth();
  const project = useProject(projectId);
  const { files } = useProjectFiles(projectId);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const codeLocked = !canUseForgeCode(usePlan());

  if (codeLocked) {
    return (
      <div className="content-area">
        <ForgeCodeUpgrade />
      </div>
    );
  }

  const startRename = () => {
    setDraftName(project?.name ?? "");
    setRenaming(true);
  };
  const saveRename = async () => {
    setRenaming(false);
    const t = draftName.trim();
    if (user && project && t && t !== project.name) {
      await updateProject(user.uid, project.id, { name: t });
    }
  };

  const onDownload = () => {
    if (project) downloadProjectZip(files, project.name);
  };

  const onPublish = async () => {
    if (!user || !project) return;
    if (effectivePreviewMode(project, files) === "none") {
      toast.info("This project type can't be published yet — download it to run.");
      return;
    }
    setPublishing(true);
    try {
      const { id } = await publishProject(user.uid, project, files);
      const url = publishedUrl(id);
      burstConfetti();
      setPublished(true);
      setTimeout(() => setPublished(false), 1800);
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Published — link copied to clipboard");
      } catch {
        toast.success("Published");
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't publish");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <TopbarFrame
        title={
          renaming ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={saveRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              style={{
                border: "1px solid var(--amber)",
                background: "var(--surface)",
                borderRadius: 7,
                padding: "4px 8px",
                font: "inherit",
                fontWeight: 600,
                color: "var(--text)",
                outline: "none",
                width: 260,
                maxWidth: "50vw",
              }}
            />
          ) : (
            <span style={{ cursor: "pointer" }} onClick={startRename} title="Rename">
              {project?.name ?? "Project"}
            </span>
          )
        }
      >
        <button className="btn-ghost" onClick={() => setHistoryOpen(true)} title="History & checkpoints">
          <History size={14} /> History
        </button>
        <button className="btn-ghost" onClick={onDownload} title="Download .zip">
          <Download size={14} /> Download
        </button>
        <button className="btn-amber" onClick={onPublish} disabled={publishing} title="Publish">
          {publishing ? (
            <Loader2 size={14} className="spin-icon" />
          ) : published ? (
            <SuccessCheck size={15} />
          ) : (
            <Share2 size={14} />
          )}{" "}
          {published ? "Published" : "Publish"}
        </button>
      </TopbarFrame>
      <div className="content-area">
        <IDE projectId={projectId} />
      </div>
      {historyOpen && (
        <CheckpointsModal projectId={projectId} files={files} onClose={() => setHistoryOpen(false)} />
      )}
    </>
  );
}

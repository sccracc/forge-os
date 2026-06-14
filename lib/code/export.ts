"use client";

import JSZip from "jszip";
import { api } from "@/lib/data/authed-fetch";
import { uid as genId } from "@/lib/utils";
import { assembleWeb, bundleApp, effectivePreviewMode } from "./preview";
import type { FileDoc, ProjectDoc } from "@/lib/data/types";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download the whole project as a .zip of its real file tree. */
export async function downloadProjectZip(files: FileDoc[], projectName: string) {
  const zip = new JSZip();
  for (const f of files) {
    if (f.kind !== "file") continue;
    zip.file(f.path, f.content ?? "");
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const safe = projectName.trim().replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "project";
  triggerDownload(blob, `${safe}.zip`);
}

export interface PublishResult {
  id: string;
  url: string;
}

/**
 * Publish a static/buildable web project: assemble a self-contained HTML
 * snapshot and store it in the public `published` table (which also records the
 * link on the project, server-side). Returns the shareable link (/p/{id}).
 */
export async function publishProject(
  uid: string,
  project: ProjectDoc,
  files: FileDoc[]
): Promise<PublishResult> {
  const mode = effectivePreviewMode(project, files);
  let html: string;
  if (mode === "web") html = assembleWeb(files, undefined, false);
  else if (mode === "react" || mode === "vue") html = await bundleApp(files, mode);
  else throw new Error("This project type can't be published — download it instead.");

  const id = project.published?.id ?? genId("pub");
  await api.post("/api/data/publish", {
    id,
    projectId: project.id,
    name: project.name,
    html,
  });
  return { id, url: `/p/${id}` };
}

export function publishedUrl(id: string): string {
  if (typeof window === "undefined") return `/p/${id}`;
  return `${window.location.origin}/p/${id}`;
}

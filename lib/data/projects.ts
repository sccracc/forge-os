"use client";

import { api } from "./authed-fetch";
import { pollingSubscribe, invalidate } from "./realtime";
import { uid as genId } from "@/lib/utils";
import { getStarter } from "@/lib/code/starters";
import { detectLang } from "@/lib/code/languages";
import type { ProjectDoc, FileDoc } from "./types";

const projectsKey = (uid: string) => `projects:${uid}`;
const projectKey = (id: string) => `project:${id}`;
const filesKey = (projectId: string) => `files:${projectId}`;

export function subscribeProjects(
  uid: string,
  cb: (projects: ProjectDoc[]) => void,
  onError?: (e: Error) => void
): () => void {
  return pollingSubscribe<ProjectDoc[]>(
    projectsKey(uid),
    () => api.get<ProjectDoc[]>("/api/data/projects"),
    cb,
    onError
  );
}

export function subscribeProject(
  uid: string,
  id: string,
  cb: (project: ProjectDoc | null) => void
): () => void {
  return pollingSubscribe<ProjectDoc | null>(
    projectKey(id),
    () => api.get<ProjectDoc | null>(`/api/data/projects/${id}`),
    cb,
    () => cb(null)
  );
}

export async function createProject(
  uid: string,
  opts: { name: string; starterId: string }
): Promise<string> {
  const starter = getStarter(opts.starterId);
  const projectId = genId("proj");
  const now = Date.now();
  const files: FileDoc[] = [];

  // Scaffold the starter's files, creating folders as needed.
  const folderIds = new Map<string, string>();
  const ensureFolder = (folderPath: string, parentId: string | null): string => {
    if (folderIds.has(folderPath)) return folderIds.get(folderPath)!;
    const id = genId("folder");
    const name = folderPath.includes("/")
      ? folderPath.slice(folderPath.lastIndexOf("/") + 1)
      : folderPath;
    const node: FileDoc = {
      id,
      name,
      path: folderPath,
      parentId,
      projectId,
      kind: "folder",
      size: 0,
      createdAt: now,
      updatedAt: now,
    };
    files.push(node);
    folderIds.set(folderPath, id);
    return id;
  };

  for (const file of starter.files) {
    const segs = file.path.split("/");
    const fileName = segs.pop()!;
    let parentId: string | null = null;
    let curPath = "";
    for (const seg of segs) {
      curPath = curPath ? `${curPath}/${seg}` : seg;
      parentId = ensureFolder(curPath, parentId);
    }
    const id = genId("file");
    const lang = detectLang(fileName);
    const node: FileDoc = {
      id,
      name: fileName,
      path: file.path,
      parentId,
      projectId,
      kind: "file",
      category: lang.category,
      language: lang.language,
      mime: lang.mime,
      size: new Blob([file.content]).size,
      content: file.content,
      createdAt: now,
      updatedAt: now,
    };
    files.push(node);
  }

  const project: ProjectDoc = {
    id: projectId,
    name: opts.name.trim() || "Untitled project",
    language: starter.language,
    starter: starter.id,
    previewMode: starter.previewMode,
    gradient: starter.gradient,
    fileCount: starter.files.length,
    createdAt: now,
    updatedAt: now,
  };
  await api.post("/api/data/projects", { project, files });
  invalidate(projectsKey(uid));
  return projectId;
}

export async function updateProject(
  uid: string,
  id: string,
  patch: Partial<ProjectDoc>
): Promise<void> {
  await api.patch(`/api/data/projects/${id}`, { ...patch, updatedAt: Date.now() });
  invalidate(projectsKey(uid));
  invalidate(projectKey(id));
}

/** Updates updatedAt (+ optional fileCount) — called when project files change. */
export async function touchProject(
  uid: string,
  id: string,
  fileCount?: number
): Promise<void> {
  const patch: Partial<ProjectDoc> = { updatedAt: Date.now() };
  if (fileCount !== undefined) patch.fileCount = fileCount;
  await api.patch(`/api/data/projects/${id}`, patch).catch(() => {});
  invalidate(projectsKey(uid));
  invalidate(projectKey(id));
}

export async function deleteProject(uid: string, id: string): Promise<void> {
  await api.del(`/api/data/projects/${id}`);
  invalidate(projectsKey(uid));
  invalidate(filesKey(id));
}

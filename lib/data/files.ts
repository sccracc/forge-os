"use client";

import { api } from "./authed-fetch";
import { pollingSubscribe, invalidate } from "./realtime";
import { uid as genId } from "@/lib/utils";
import { detectLang } from "@/lib/code/languages";
import type { FileDoc } from "./types";

const filesKey = (projectId: string) => `files:${projectId}`;

const sortByPath = (files: FileDoc[]): FileDoc[] =>
  [...files].sort((a, b) => a.path.localeCompare(b.path));

export async function getProjectFilesOnce(
  uid: string,
  projectId: string
): Promise<FileDoc[]> {
  const files = await api.get<FileDoc[]>(`/api/data/projects/${projectId}/files`);
  return sortByPath(files);
}

export function subscribeProjectFiles(
  uid: string,
  projectId: string,
  cb: (files: FileDoc[]) => void
): () => void {
  return pollingSubscribe<FileDoc[]>(
    filesKey(projectId),
    () => getProjectFilesOnce(uid, projectId),
    cb
  );
}

interface CreateNodeInput {
  name: string;
  parentId: string | null;
  parentPath: string | null;
  projectId: string | null;
  kind: "file" | "folder";
  content?: string;
}

export async function createNode(uid: string, input: CreateNodeInput): Promise<string> {
  const id = genId(input.kind);
  const now = Date.now();
  const path = input.parentPath ? `${input.parentPath}/${input.name}` : input.name;
  const lang = input.kind === "file" ? detectLang(input.name) : null;
  const node: FileDoc = {
    id,
    name: input.name,
    path,
    parentId: input.parentId,
    projectId: input.projectId,
    kind: input.kind,
    category: lang?.category,
    language: lang?.language,
    mime: lang?.mime,
    size: input.content ? new Blob([input.content]).size : 0,
    content: input.kind === "file" ? input.content ?? "" : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await api.post("/api/data/files", node);
  if (input.projectId) invalidate(filesKey(input.projectId));
  return id;
}

export async function updateContent(uid: string, id: string, content: string): Promise<void> {
  await api.patch(`/api/data/files/${id}`, {
    content,
    size: new Blob([content]).size,
    updatedAt: Date.now(),
  });
  // The file tree shows names, not content, and the editor/preview render from
  // in-memory state — so a content save needs no key invalidation; the
  // project-files poll keeps other tabs/devices eventually consistent.
}

function descendants(files: FileDoc[], folderPath: string): FileDoc[] {
  return files.filter((f) => f.path.startsWith(folderPath + "/"));
}

export async function renameNode(
  uid: string,
  node: FileDoc,
  newName: string
): Promise<void> {
  const parentPath = node.path.includes("/")
    ? node.path.slice(0, node.path.lastIndexOf("/"))
    : "";
  const newPath = parentPath ? `${parentPath}/${newName}` : newName;
  const updates: { id: string; patch: Partial<FileDoc> }[] = [];
  const patch: Partial<FileDoc> = { name: newName, path: newPath, updatedAt: Date.now() };
  if (node.kind === "file") {
    const lang = detectLang(newName);
    patch.language = lang.language;
    patch.category = lang.category;
    patch.mime = lang.mime;
  }
  updates.push({ id: node.id, patch });
  if (node.kind === "folder" && node.projectId) {
    const files = await getProjectFilesOnce(uid, node.projectId);
    for (const d of descendants(files, node.path)) {
      updates.push({
        id: d.id,
        patch: { path: newPath + d.path.slice(node.path.length), updatedAt: Date.now() },
      });
    }
  }
  await api.post("/api/data/files/bulk", { updates });
  if (node.projectId) invalidate(filesKey(node.projectId));
}

export async function moveNode(
  uid: string,
  node: FileDoc,
  newParent: FileDoc | null,
  projectId: string
): Promise<void> {
  // Prevent moving a folder into itself / its descendants.
  if (newParent && (newParent.id === node.id || newParent.path.startsWith(node.path + "/")))
    return;
  const newParentPath = newParent ? newParent.path : "";
  const newPath = newParentPath ? `${newParentPath}/${node.name}` : node.name;
  if (newPath === node.path) return;
  const updates: { id: string; patch: Partial<FileDoc> }[] = [
    {
      id: node.id,
      patch: {
        parentId: newParent ? newParent.id : null,
        path: newPath,
        updatedAt: Date.now(),
      },
    },
  ];
  if (node.kind === "folder") {
    const files = await getProjectFilesOnce(uid, projectId);
    for (const d of descendants(files, node.path)) {
      updates.push({
        id: d.id,
        patch: { path: newPath + d.path.slice(node.path.length), updatedAt: Date.now() },
      });
    }
  }
  await api.post("/api/data/files/bulk", { updates });
  invalidate(filesKey(projectId));
}

export async function deleteNode(uid: string, node: FileDoc): Promise<void> {
  const deletes: string[] = [node.id];
  if (node.kind === "folder" && node.projectId) {
    const files = await getProjectFilesOnce(uid, node.projectId);
    for (const d of descendants(files, node.path)) deletes.push(d.id);
  }
  await api.post("/api/data/files/bulk", { deletes });
  if (node.projectId) invalidate(filesKey(node.projectId));
}

export async function duplicateNode(uid: string, node: FileDoc): Promise<void> {
  if (node.kind !== "file") return;
  const dot = node.name.lastIndexOf(".");
  const newName =
    dot > 0 ? `${node.name.slice(0, dot)}-copy${node.name.slice(dot)}` : `${node.name}-copy`;
  const parentPath = node.path.includes("/")
    ? node.path.slice(0, node.path.lastIndexOf("/"))
    : null;
  await createNode(uid, {
    name: newName,
    parentId: node.parentId,
    parentPath,
    projectId: node.projectId,
    kind: "file",
    content: node.content ?? "",
  });
}

/**
 * Writes a set of {path, content} files into a project, creating any missing
 * parent folders and updating existing files in place. Used by the AI build
 * dock. One read + one batched write.
 */
export async function writeFilesByPath(
  uid: string,
  projectId: string,
  incoming: { path: string; content: string }[]
): Promise<{ created: number; updated: number }> {
  const files = await getProjectFilesOnce(uid, projectId);
  const byPath = new Map<string, FileDoc>();
  files.forEach((f) => byPath.set(f.path, f));
  const inserts: FileDoc[] = [];
  const updates: { id: string; patch: Partial<FileDoc> }[] = [];
  const now = Date.now();
  let created = 0;
  let updated = 0;

  const ensureFolder = (folderPath: string, parentId: string | null): string => {
    const existing = byPath.get(folderPath);
    if (existing) return existing.id;
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
    inserts.push(node);
    byPath.set(folderPath, node);
    created++;
    return id;
  };

  for (const item of incoming) {
    const normalized = item.path.replace(/^\/+/, "").replace(/\\/g, "/");
    if (!normalized) continue;
    // Guard against absurdly large inline files (large data belongs in Storage,
    // loaded at runtime with fetch()).
    const byteSize = new Blob([item.content]).size;
    if (byteSize > 900_000) {
      throw new Error(
        `"${normalized}" is too large to save inline (~${Math.round(byteSize / 1024)} KB; the limit is ~1 MB per file). Large data must be loaded at runtime with fetch(), not embedded.`
      );
    }
    const segs = normalized.split("/");
    const fileName = segs.pop()!;
    let parentId: string | null = null;
    let curPath = "";
    for (const seg of segs) {
      curPath = curPath ? `${curPath}/${seg}` : seg;
      parentId = ensureFolder(curPath, parentId);
    }
    const existing = byPath.get(normalized);
    const lang = detectLang(fileName);
    if (existing && existing.kind === "file") {
      updates.push({
        id: existing.id,
        patch: { content: item.content, size: new Blob([item.content]).size, updatedAt: now },
      });
      updated++;
    } else {
      const id = genId("file");
      const node: FileDoc = {
        id,
        name: fileName,
        path: normalized,
        parentId,
        projectId,
        kind: "file",
        category: lang.category,
        language: lang.language,
        mime: lang.mime,
        size: new Blob([item.content]).size,
        content: item.content,
        createdAt: now,
        updatedAt: now,
      };
      inserts.push(node);
      byPath.set(normalized, node);
      created++;
    }
  }
  await api.post("/api/data/files/bulk", { inserts, updates });
  invalidate(filesKey(projectId));
  return { created, updated };
}

export async function getFileOnce(uid: string, id: string): Promise<FileDoc | null> {
  return api.get<FileDoc | null>(`/api/data/files/${id}`);
}

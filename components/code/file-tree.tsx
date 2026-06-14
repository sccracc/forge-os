"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  List,
  LayoutGrid,
  Pencil,
  Copy,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { detectLang } from "@/lib/code/languages";
import {
  createNode,
  renameNode,
  deleteNode,
  duplicateNode,
  moveNode,
} from "@/lib/data/files";
import { toast } from "@/lib/store/toast-store";
import { confirm } from "@/lib/store/confirm-store";
import type { FileDoc } from "@/lib/data/types";

interface FileTreeProps {
  files: FileDoc[];
  projectId: string;
  activeFileId: string | null;
  onOpen: (file: FileDoc) => void;
}

interface Creating {
  parentId: string | null;
  parentPath: string | null;
  kind: "file" | "folder";
}
interface MenuState {
  x: number;
  y: number;
  node: FileDoc | null; // null = root background
}

export function FileTree({ files, projectId, activeFileId, onOpen }: FileTreeProps) {
  const { user } = useAuth();
  const [view, setView] = useState<"tree" | "grid">("tree");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [gridFolder, setGridFolder] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [extDrag, setExtDrag] = useState(false);
  const [uploads, setUploads] = useState<string[]>([]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, FileDoc[]>();
    for (const f of files) {
      const k = f.parentId ?? null;
      const arr = m.get(k) ?? [];
      arr.push(f);
      m.set(k, arr);
    }
    for (const arr of m.values())
      arr.sort((a, b) =>
        a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name)
      );
    return m;
  }, [files]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  if (!user) return null;
  const uid = user.uid;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const startCreate = (parent: FileDoc | null, kind: "file" | "folder") => {
    if (parent) setExpanded((p) => new Set(p).add(parent.id));
    setCreating({ parentId: parent?.id ?? null, parentPath: parent?.path ?? null, kind });
    setMenu(null);
  };

  const commitCreate = async (name: string) => {
    const c = creating;
    setCreating(null);
    if (!c || !name.trim()) return;
    await createNode(uid, {
      name: name.trim(),
      parentId: c.parentId,
      parentPath: c.parentPath,
      projectId,
      kind: c.kind,
      content: c.kind === "file" ? "" : undefined,
    });
  };

  const commitRename = async (node: FileDoc, name: string) => {
    setRenaming(null);
    if (name.trim() && name.trim() !== node.name) await renameNode(uid, node, name.trim());
  };

  const onDrop = async (target: FileDoc | null) => {
    if (!dragId) return;
    const node = files.find((f) => f.id === dragId);
    setDragId(null);
    if (!node) return;
    if (target && target.kind !== "folder") return;
    await moveNode(uid, node, target, projectId);
  };

  const remove = async (node: FileDoc) => {
    setMenu(null);
    if (
      !(await confirm({
        title: `Delete “${node.name}”?`,
        message:
          node.kind === "folder"
            ? "This folder and everything inside it will be deleted."
            : "This file will be permanently deleted.",
        confirmLabel: "Delete",
      }))
    )
      return;
    await deleteNode(uid, node);
    toast.success("Deleted");
  };

  // #41/42/43 · import real files dropped from the OS into the project root.
  const importFiles = async (fileList: FileList) => {
    setExtDrag(false);
    const arr = Array.from(fileList)
      .filter((f) => f.size <= 2_000_000)
      .slice(0, 12);
    if (arr.length === 0) return;
    setUploads(arr.map((f) => f.name));
    let added = 0;
    for (const f of arr) {
      try {
        const text = await f.text();
        await createNode(uid, {
          name: f.name,
          parentId: null,
          parentPath: null,
          projectId,
          kind: "file",
          content: text,
        });
        added++;
      } catch {
        /* skip unreadable file */
      }
    }
    setTimeout(() => setUploads([]), 1100);
    if (added) toast.success(`Added ${added} file${added === 1 ? "" : "s"}`);
  };

  const NameInput = ({
    initial,
    onCommit,
    onCancel,
  }: {
    initial: string;
    onCommit: (v: string) => void;
    onCancel: () => void;
  }) => {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => ref.current?.focus(), []);
    return (
      <input
        ref={ref}
        defaultValue={initial}
        className="ft-input"
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit((e.target as HTMLInputElement).value);
          if (e.key === "Escape") onCancel();
        }}
      />
    );
  };

  const renderNode = (node: FileDoc, depth: number): React.ReactNode => {
    const isFolder = node.kind === "folder";
    const open = expanded.has(node.id);
    const lang = isFolder ? null : detectLang(node.name);
    return (
      <div key={node.id}>
        <div
          className={`ft-row ${activeFileId === node.id ? "active" : ""} ${dragId === node.id ? "dragging" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable
          onDragStart={(e) => {
            setDragId(node.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => isFolder && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDrop(isFolder ? node : null);
          }}
          onClick={() => (isFolder ? toggle(node.id) : onOpen(node))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, node });
          }}
        >
          {isFolder ? (
            <ChevronRight className={`ft-chev ${open ? "open" : ""}`} size={13} />
          ) : (
            <span className="ft-chev-spacer" />
          )}
          {isFolder ? (
            open ? (
              <FolderOpen size={14} className="ft-icon" style={{ color: "var(--amber)" }} />
            ) : (
              <Folder size={14} className="ft-icon" style={{ color: "var(--amber)" }} />
            )
          ) : (
            <FileIcon size={14} className="ft-icon" style={{ color: lang!.color }} />
          )}
          {renaming === node.id ? (
            <NameInput
              initial={node.name}
              onCommit={(v) => commitRename(node, v)}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span className="ft-name">{node.name}</span>
          )}
        </div>
        {isFolder && open && (
          <div className="ft-children">
            {creating && creating.parentId === node.id && (
              <div className="ft-row" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
                <span className="ft-chev-spacer" />
                {creating.kind === "folder" ? (
                  <Folder size={14} className="ft-icon" style={{ color: "var(--amber)" }} />
                ) : (
                  <FileIcon size={14} className="ft-icon" />
                )}
                <NameInput
                  initial=""
                  onCommit={commitCreate}
                  onCancel={() => setCreating(null)}
                />
              </div>
            )}
            {(childrenOf.get(node.id) ?? []).map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // ---- Grid view ----
  const gridItems = childrenOf.get(gridFolder) ?? [];
  const gridCrumbs = (() => {
    if (!gridFolder) return [{ id: null as string | null, name: "Project" }];
    const node = files.find((f) => f.id === gridFolder);
    const crumbs: { id: string | null; name: string }[] = [{ id: null, name: "Project" }];
    if (node) {
      const segs = node.path.split("/");
      let acc = "";
      for (const seg of segs) {
        acc = acc ? `${acc}/${seg}` : seg;
        const f = files.find((x) => x.path === acc && x.kind === "folder");
        if (f) crumbs.push({ id: f.id, name: seg });
      }
    }
    return crumbs;
  })();

  return (
    <div className="file-tree" style={{ position: "relative" }}>
      <div className="ft-header">
        <span className="ft-title">Explorer</span>
        <div className="ft-actions">
          <button className="ft-act" data-tip="New file" onClick={() => startCreate(null, "file")}>
            <FilePlus size={15} />
          </button>
          <button className="ft-act" data-tip="New folder" onClick={() => startCreate(null, "folder")}>
            <FolderPlus size={15} />
          </button>
          <button
            className="ft-act"
            data-tip={view === "tree" ? "Grid view" : "Tree view"}
            onClick={() => setView(view === "tree" ? "grid" : "tree")}
          >
            {view === "tree" ? <LayoutGrid size={15} /> : <List size={15} />}
          </button>
        </div>
      </div>

      {view === "tree" ? (
        <div
          className="ft-body"
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes("Files")) setExtDrag(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setExtDrag(false);
          }}
          onDrop={(e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              e.preventDefault();
              importFiles(e.dataTransfer.files);
            } else {
              onDrop(null);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, node: null });
          }}
        >
          {creating && creating.parentId === null && (
            <div className="ft-row" style={{ paddingLeft: 8 }}>
              <span className="ft-chev-spacer" />
              {creating.kind === "folder" ? (
                <Folder size={14} className="ft-icon" style={{ color: "var(--amber)" }} />
              ) : (
                <FileIcon size={14} className="ft-icon" />
              )}
              <NameInput initial="" onCommit={commitCreate} onCancel={() => setCreating(null)} />
            </div>
          )}
          {(childrenOf.get(null) ?? []).map((n) => renderNode(n, 0))}
          {files.length === 0 && <div className="ft-empty">No files yet.</div>}
        </div>
      ) : (
        <div className="ft-grid-wrap">
          <div className="ft-breadcrumb">
            {gridCrumbs.map((c, i) => (
              <span key={c.id ?? "root"}>
                {i > 0 && <span className="ft-bc-sep">/</span>}
                <button className="ft-bc" onClick={() => setGridFolder(c.id)}>
                  {c.name}
                </button>
              </span>
            ))}
          </div>
          <div className="ft-grid">
            {gridItems.map((node) => {
              const lang = node.kind === "file" ? detectLang(node.name) : null;
              return (
                <button
                  key={node.id}
                  className="ft-card"
                  onDoubleClick={() => (node.kind === "folder" ? setGridFolder(node.id) : onOpen(node))}
                  onClick={() => node.kind === "file" && onOpen(node)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, node });
                  }}
                >
                  {node.kind === "folder" ? (
                    <Folder size={28} style={{ color: "var(--amber)" }} />
                  ) : (
                    <FileIcon size={28} style={{ color: lang!.color }} />
                  )}
                  <span className="ft-card-name">{node.name}</span>
                </button>
              );
            })}
            {gridItems.length === 0 && <div className="ft-empty">Empty folder.</div>}
          </div>
        </div>
      )}

      {menu && (
        <div className="ft-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button className="ft-menu-item" onClick={() => startCreate(menu.node?.kind === "folder" ? menu.node : null, "file")}>
            <FilePlus size={14} /> New file
          </button>
          <button className="ft-menu-item" onClick={() => startCreate(menu.node?.kind === "folder" ? menu.node : null, "folder")}>
            <FolderPlus size={14} /> New folder
          </button>
          {menu.node && (
            <>
              <div className="ft-menu-sep" />
              <button className="ft-menu-item" onClick={() => { setRenaming(menu.node!.id); setMenu(null); }}>
                <Pencil size={14} /> Rename
              </button>
              {menu.node.kind === "file" && (
                <button className="ft-menu-item" onClick={() => { duplicateNode(uid, menu.node!); setMenu(null); }}>
                  <Copy size={14} /> Duplicate
                </button>
              )}
              <button className="ft-menu-item danger" onClick={() => remove(menu.node!)}>
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}
        </div>
      )}

      {extDrag && <div className="ft-dropzone">Drop files to add to the project</div>}
      {uploads.length > 0 && (
        <div className="ft-uploads">
          {uploads.map((n) => (
            <div className="ft-upload" key={n}>
              <span className="ufill2" />
              <span className="uname2">📄 {n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

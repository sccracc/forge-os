"use client";

import JSZip from "jszip";
import { api } from "@/lib/data/authed-fetch";
import type {
  ConversationDoc,
  MessageDoc,
  FileDoc,
  ProjectDoc,
  Skill,
  UserProfile,
} from "@/lib/data/types";

function safeName(s: string, fallback = "untitled"): string {
  return s.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || fallback;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Render a conversation (a linear message path) to clean, branded Markdown. */
export function conversationToMarkdown(
  conv: Pick<ConversationDoc, "title" | "createdAt">,
  messages: Pick<MessageDoc, "role" | "content" | "reasoning">[],
  opts: { includeThinking?: boolean } = {}
): string {
  const out: string[] = [
    `# ${conv.title || "Conversation"}`,
    "",
    `_Exported from Forge OS · ${new Date().toLocaleString()}_`,
    "",
    "---",
    "",
  ];
  for (const m of messages) {
    if (m.role === "user") {
      out.push("### You", "", m.content.trim(), "");
    } else if (m.role === "assistant") {
      out.push("### Forge OS", "");
      if (opts.includeThinking && m.reasoning?.trim()) {
        out.push("<details><summary>Thinking</summary>", "", "```", m.reasoning.trim(), "```", "", "</details>", "");
      }
      out.push(m.content.trim(), "");
    }
  }
  return out.join("\n");
}

export function exportConversationMarkdown(
  conv: Pick<ConversationDoc, "title" | "createdAt">,
  messages: Pick<MessageDoc, "role" | "content" | "reasoning">[],
  opts?: { includeThinking?: boolean }
) {
  const md = conversationToMarkdown(conv, messages, opts);
  triggerDownload(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${safeName(conv.title)}.md`);
}

interface ExportPayload {
  conversations: { conversation: ConversationDoc; messages: MessageDoc[] }[];
  files: FileDoc[];
  projects: ProjectDoc[];
  skills: Skill[];
  profile: UserProfile | null;
}

/** "Download all my data" — a .zip of conversations, files, projects, skills, memory. */
export async function exportAllData(uid: string): Promise<void> {
  const data = await api.get<ExportPayload>("/api/data/export");
  const zip = new JSZip();

  // Conversations (JSON + Markdown), with their messages.
  const conv = zip.folder("conversations")!;
  for (const { conversation: cdata, messages: msgs } of data.conversations) {
    const base = `${safeName(cdata.title, cdata.id)}-${cdata.id.slice(-6)}`;
    conv.file(`${base}.md`, conversationToMarkdown(cdata, msgs, { includeThinking: true }));
    conv.file(`${base}.json`, JSON.stringify({ conversation: cdata, messages: msgs }, null, 2));
  }

  // Files (real contents where inline).
  const filesFolder = zip.folder("files")!;
  const fileMeta: unknown[] = [];
  for (const fd of data.files) {
    fileMeta.push(fd);
    if (fd.kind === "file" && typeof fd.content === "string") {
      filesFolder.file(fd.path || fd.name, fd.content);
    }
  }
  filesFolder.file("_files.json", JSON.stringify(fileMeta, null, 2));

  // Projects, skills, profile/memory.
  zip.file("projects.json", JSON.stringify(data.projects, null, 2));
  zip.file("skills.json", JSON.stringify(data.skills, null, 2));
  if (data.profile) {
    zip.file("memory.txt", data.profile.memoryProfile || "(no memory)");
    zip.file("profile.json", JSON.stringify(data.profile, null, 2));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `forge-os-export-${new Date().toISOString().slice(0, 10)}.zip`);
}

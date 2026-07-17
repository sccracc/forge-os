import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { ToolSpec } from "./tools";

// Forge Code project tools — the build agent's "hands" on the project itself.
//
// Retrieval inlines only the most relevant files and summarizes the rest, so
// without these tools the model has to GUESS the contents of anything not
// inlined — the root cause of mismatched SEARCH hunks and hallucinated
// imports. With them, any Forge Code call (build / plan / verify / fix /
// discuss) can pull the exact current text of any project file, or grep the
// whole project, mid-generation. Reads are scoped server-side to the verified
// uid + project (never client-trusted) and are free: reading your own files
// consumes no feature quota.

export const READ_PROJECT_FILES_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "read_project_files",
    description:
      "Read the FULL, CURRENT contents of one or more files in this project. Call this before editing any file whose complete contents are not already in your context — never guess or reconstruct file contents from memory or from a signature. Paths must match the project file tree exactly.",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Project-relative file paths to read (max 8 per call).",
        },
      },
      required: ["paths"],
    },
  },
};

export const SEARCH_PROJECT_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "search_project",
    description:
      "Search every file in this project for a string or regular expression and get back matching lines with file paths and line numbers. Use it to find where something is defined or referenced (a function, a class name, a color, brand text) before changing it — especially for rename/consistency work across many files.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Text or JavaScript regular expression to search for.",
        },
        regex: {
          type: "boolean",
          description: "Treat pattern as a regular expression (default false).",
        },
      },
      required: ["pattern"],
    },
  },
};

export const CODE_PROJECT_TOOLS: ToolSpec[] = [READ_PROJECT_FILES_TOOL, SEARCH_PROJECT_TOOL];

const MAX_FILES_PER_READ = 8;
const MAX_READ_BYTES = 120_000; // per call, so tool results can't blow the context
const MAX_SEARCH_MATCHES = 60;
const MAX_LINE_LEN = 300;

interface ProjectFileRow {
  path: string;
  content: string | null;
  kind: string | null;
}

async function loadProjectFiles(uid: string, projectId: string): Promise<ProjectFileRow[]> {
  const { data, error } = await supabaseAdmin
    .from("files")
    .select("path, content, kind")
    .eq("user_id", uid)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((f: ProjectFileRow) => (f.kind ?? "file") === "file");
}

/** Tool result payloads are JSON strings fed straight back to the model. */
export async function executeReadProjectFiles(
  uid: string,
  projectId: string,
  args: { paths?: unknown }
): Promise<{ content: string; count: number }> {
  try {
    const requested = Array.isArray(args.paths)
      ? args.paths.filter((p): p is string => typeof p === "string").slice(0, MAX_FILES_PER_READ)
      : [];
    if (requested.length === 0) {
      return { content: JSON.stringify({ error: "No paths given." }), count: 0 };
    }
    const files = await loadProjectFiles(uid, projectId);
    const byPath = new Map(files.map((f) => [f.path, f.content ?? ""]));
    let budget = MAX_READ_BYTES;
    const out: { path: string; content?: string; error?: string; truncated?: boolean }[] = [];
    for (const path of requested) {
      if (!byPath.has(path)) {
        out.push({ path, error: "File not found — check the file tree for the exact path." });
        continue;
      }
      const content = byPath.get(path)!;
      if (content.length <= budget) {
        out.push({ path, content });
        budget -= content.length;
      } else if (budget > 4_000) {
        out.push({ path, content: content.slice(0, budget), truncated: true });
        budget = 0;
      } else {
        out.push({ path, error: "Read budget for this call exhausted — request this file alone in a follow-up call." });
      }
    }
    return { content: JSON.stringify({ files: out }), count: 0 };
  } catch {
    return { content: JSON.stringify({ error: "Could not read project files right now." }), count: 0 };
  }
}

export async function executeSearchProject(
  uid: string,
  projectId: string,
  args: { pattern?: unknown; regex?: unknown }
): Promise<{ content: string; count: number }> {
  try {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) return { content: JSON.stringify({ error: "No pattern given." }), count: 0 };
    let matcher: (line: string) => boolean;
    if (args.regex === true) {
      let re: RegExp;
      try {
        re = new RegExp(pattern, "i");
      } catch {
        return { content: JSON.stringify({ error: "Invalid regular expression." }), count: 0 };
      }
      matcher = (line) => re.test(line);
    } else {
      const needle = pattern.toLowerCase();
      matcher = (line) => line.toLowerCase().includes(needle);
    }
    const files = await loadProjectFiles(uid, projectId);
    const matches: { path: string; line: number; text: string }[] = [];
    for (const f of files) {
      const lines = (f.content ?? "").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (matcher(lines[i])) {
          matches.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, MAX_LINE_LEN) });
          if (matches.length >= MAX_SEARCH_MATCHES) break;
        }
      }
      if (matches.length >= MAX_SEARCH_MATCHES) break;
    }
    return {
      content: JSON.stringify({
        matches,
        truncated: matches.length >= MAX_SEARCH_MATCHES,
      }),
      count: 0,
    };
  } catch {
    return { content: JSON.stringify({ error: "Could not search the project right now." }), count: 0 };
  }
}

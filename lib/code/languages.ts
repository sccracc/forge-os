import type { FileCategory } from "@/lib/data/types";

export interface LangInfo {
  /** Monaco language id. */
  language: string;
  category: FileCategory;
  mime: string;
  /** Human label, e.g. "TypeScript". */
  label: string;
  /** Dot color for file-tree / tabs. */
  color: string;
}

const TEXT: LangInfo = {
  language: "plaintext",
  category: "text",
  mime: "text/plain",
  label: "Text",
  color: "#9a8e7b",
};

const MAP: Record<string, LangInfo> = {
  js: { language: "javascript", category: "code", mime: "text/javascript", label: "JavaScript", color: "#f7df1e" },
  mjs: { language: "javascript", category: "code", mime: "text/javascript", label: "JavaScript", color: "#f7df1e" },
  cjs: { language: "javascript", category: "code", mime: "text/javascript", label: "JavaScript", color: "#f7df1e" },
  jsx: { language: "javascript", category: "code", mime: "text/javascript", label: "JSX", color: "#61dafb" },
  ts: { language: "typescript", category: "code", mime: "text/typescript", label: "TypeScript", color: "#3178c6" },
  tsx: { language: "typescript", category: "code", mime: "text/typescript", label: "TSX", color: "#61dafb" },
  html: { language: "html", category: "code", mime: "text/html", label: "HTML", color: "#e34c26" },
  htm: { language: "html", category: "code", mime: "text/html", label: "HTML", color: "#e34c26" },
  css: { language: "css", category: "code", mime: "text/css", label: "CSS", color: "#563d7c" },
  scss: { language: "scss", category: "code", mime: "text/x-scss", label: "SCSS", color: "#c6538c" },
  sass: { language: "scss", category: "code", mime: "text/x-scss", label: "Sass", color: "#c6538c" },
  less: { language: "less", category: "code", mime: "text/x-less", label: "Less", color: "#1d365d" },
  json: { language: "json", category: "code", mime: "application/json", label: "JSON", color: "#cbcb41" },
  jsonc: { language: "json", category: "code", mime: "application/json", label: "JSON", color: "#cbcb41" },
  md: { language: "markdown", category: "markdown", mime: "text/markdown", label: "Markdown", color: "#519aba" },
  markdown: { language: "markdown", category: "markdown", mime: "text/markdown", label: "Markdown", color: "#519aba" },
  py: { language: "python", category: "code", mime: "text/x-python", label: "Python", color: "#3572A5" },
  rb: { language: "ruby", category: "code", mime: "text/x-ruby", label: "Ruby", color: "#cc342d" },
  php: { language: "php", category: "code", mime: "application/x-httpd-php", label: "PHP", color: "#4f5d95" },
  go: { language: "go", category: "code", mime: "text/x-go", label: "Go", color: "#00add8" },
  rs: { language: "rust", category: "code", mime: "text/x-rust", label: "Rust", color: "#dea584" },
  java: { language: "java", category: "code", mime: "text/x-java", label: "Java", color: "#b07219" },
  c: { language: "c", category: "code", mime: "text/x-c", label: "C", color: "#555555" },
  h: { language: "c", category: "code", mime: "text/x-c", label: "C Header", color: "#555555" },
  cpp: { language: "cpp", category: "code", mime: "text/x-c++", label: "C++", color: "#f34b7d" },
  cc: { language: "cpp", category: "code", mime: "text/x-c++", label: "C++", color: "#f34b7d" },
  cs: { language: "csharp", category: "code", mime: "text/x-csharp", label: "C#", color: "#178600" },
  vue: { language: "html", category: "code", mime: "text/x-vue", label: "Vue", color: "#41b883" },
  svelte: { language: "html", category: "code", mime: "text/x-svelte", label: "Svelte", color: "#ff3e00" },
  yaml: { language: "yaml", category: "code", mime: "text/yaml", label: "YAML", color: "#cb171e" },
  yml: { language: "yaml", category: "code", mime: "text/yaml", label: "YAML", color: "#cb171e" },
  toml: { language: "ini", category: "code", mime: "text/x-toml", label: "TOML", color: "#9c4221" },
  sql: { language: "sql", category: "code", mime: "text/x-sql", label: "SQL", color: "#e38c00" },
  sh: { language: "shell", category: "code", mime: "text/x-sh", label: "Shell", color: "#89e051" },
  bash: { language: "shell", category: "code", mime: "text/x-sh", label: "Shell", color: "#89e051" },
  xml: { language: "xml", category: "code", mime: "text/xml", label: "XML", color: "#0060ac" },
  txt: TEXT,
  png: { language: "plaintext", category: "image", mime: "image/png", label: "PNG", color: "#a074c4" },
  jpg: { language: "plaintext", category: "image", mime: "image/jpeg", label: "JPEG", color: "#a074c4" },
  jpeg: { language: "plaintext", category: "image", mime: "image/jpeg", label: "JPEG", color: "#a074c4" },
  gif: { language: "plaintext", category: "image", mime: "image/gif", label: "GIF", color: "#a074c4" },
  svg: { language: "xml", category: "image", mime: "image/svg+xml", label: "SVG", color: "#ffb13b" },
  webp: { language: "plaintext", category: "image", mime: "image/webp", label: "WebP", color: "#a074c4" },
  pdf: { language: "plaintext", category: "pdf", mime: "application/pdf", label: "PDF", color: "#e5484d" },
};

export function detectLang(name: string): LangInfo {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return MAP[ext] ?? TEXT;
}

export function isTextCategory(c: FileCategory | undefined): boolean {
  return c === "text" || c === "code" || c === "markdown";
}

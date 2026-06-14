import type { ForgeModelId } from "@/lib/ai/models.public";
import type { EffortId } from "@/lib/ai/effort";

export type Role = "user" | "assistant" | "system" | "tool";

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export interface MessageImageAttachment {
  type: "image";
  base64: string;
  mimeType: ImageMimeType;
}

export interface MessageGeneratedImageAttachment {
  type: "generated_image";
  imageUrl: string;
  prompt: string;
  /** Disclaimer shown when the image was a half-counted fallback. */
  notice?: string;
}

export interface MessageDocumentAttachment {
  type: "document";
  name: string;
  /** True when the PDF had no text layer and was AI-analyzed (counted). */
  analyzed?: boolean;
}

export type MessageAttachment =
  | MessageImageAttachment
  | MessageGeneratedImageAttachment
  | MessageDocumentAttachment;
export type MessageAttachments = MessageAttachment | MessageAttachment[];

/** What the composer hands to the send controller / chat route for one turn. */
export interface OutgoingAttachments {
  /** Images analyzed by Forge Vision (or, for one image + edit intent, edited). */
  images: MessageImageAttachment[];
  /** PDFs parsed to text in the browser — free, ungated context. */
  documents: { name: string; text: string }[];
  /** Scanned PDFs rendered to page images for gated AI analysis. */
  scannedPdfs: { name: string; pages: { base64: string; mimeType: ImageMimeType }[] }[];
}

export interface ConversationDoc {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectId: string | null;
  model: ForgeModelId;
  effort: EffortId;
  thinking: boolean;
  pinned?: boolean;
  agentId?: string | null;
  /** The leaf message id of the currently selected branch path. */
  activeLeafId?: string | null;
}

export interface MessageDoc {
  id: string;
  role: Role;
  content: string;
  reasoning?: string;
  reasoningMs?: number;
  /** Parent message id — messages form a tree; null for the root user turn. */
  parentId: string | null;
  createdAt: number;
  model?: ForgeModelId;
  effort?: EffortId;
  thinking?: boolean;
  tokens?: number;
  /** Usage-tracking breakdown for this assistant turn (§15). */
  realTokensUsed?: number;
  forgeTokensDeducted?: number;
  multiplierUsed?: number;
  hadToolCall?: boolean;
  error?: boolean;
  /** Skills that were active when this assistant turn was generated. */
  skillsUsed?: SkillRef[];
  /** Agent that was active when this assistant turn was generated. */
  agentUsed?: AgentRef;
  /** Web searches performed during this turn — persisted so source chips
   *  remain visible after the stream ends and across reloads. */
  searches?: MessageSearch[];
  /** Optional user-visible attachment stored in messages.attachments. */
  attachments?: MessageAttachments;
}

/** A persisted web search performed during an assistant turn. */
export interface MessageSearch {
  query: string;
  count: number;
  sources?: { title: string; url: string }[];
}

export interface UserProfile {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  /** Billing plan id ("free" | "starter" | "pro" | "max" | "ultra"). Drives feature gating. */
  plan?: string;
  // Defaults (§6)
  defaultModel: ForgeModelId;
  defaultEffort: EffortId;
  defaultThinking: boolean;
  defaultToolsEnabled: boolean;
  defaultPreviewMode: "auto" | "code" | "split" | "preview";
  /** Forge Code build agent autonomy: auto = plan+build+verify+heal silently;
   *  plan = show the plan and wait for one approval; step = approve each step. */
  buildAutonomy?: "auto" | "plan" | "step";
  // Personalization (two custom-instruction fields injected into the prompt)
  customAbout: string;
  customStyle: string;
  // Memory (§12)
  memoryEnabled: boolean;
  searchChatsEnabled: boolean;
  memoryProfile: string;
  /** Whether the built-in skills have been provisioned for this user. */
  skillsSeeded?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type FileCategory =
  | "text"
  | "code"
  | "markdown"
  | "image"
  | "pdf"
  | "office"
  | "binary";

export type PreviewKind = "web" | "react" | "vue" | "none";

export interface ProjectDoc {
  id: string;
  name: string;
  description?: string;
  /** Primary language label, e.g. "HTML", "React", "Python". */
  language: string;
  /** Starter id used to scaffold: blank | html | react | vue | python. */
  starter: string;
  previewMode: PreviewKind;
  /** Two hex colors seeding the gradient thumbnail. */
  gradient: [string, string];
  fileCount: number;
  /** Root-level FORGE.md contents (project rules), injected into project chats. */
  forgeMd?: string;
  published?: { id: string; at: number };
  createdAt: number;
  updatedAt: number;
}

// FORGE-NOTE: files + folders share one collection (users/{uid}/files) with a
// `kind` discriminator forming the nested tree via parentId — simpler than two
// collections; security rules cover users/{uid}/** either way.
export interface FileDoc {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  projectId: string | null;
  kind: "file" | "folder";
  category?: FileCategory;
  language?: string;
  mime?: string;
  size: number;
  /** Inline content for small text/code/markdown. */
  content?: string;
  /** Firebase Storage object path for binary/large blobs. */
  storagePath?: string;
  /** Firestore base64-chunk fallback marker (chunks under files/{id}/chunks). */
  chunked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SkillFile {
  name: string;
  content: string;
}

/** A point-in-time snapshot of a project's files (for restore/version history). */
export interface CheckpointFile {
  path: string;
  content: string;
}
export interface CheckpointDoc {
  id: string;
  projectId: string;
  label: string;
  kind: "auto" | "manual";
  at: number;
  fileCount: number;
  files: CheckpointFile[];
}

/** Lightweight reference to a skill, used by the "Reading … SKILL.md" indicator. */
export interface SkillRef {
  name: string;
  slug: string;
}

/** Lightweight reference to an agent, used by the "responding as <agent>" badge. */
export interface AgentRef {
  id: string;
  name: string;
  avatar?: string;
}

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  enabled: boolean;
  builtin?: boolean;
  icon?: string;
  category?: string;
  version?: number;
  files?: SkillFile[];
  favorite?: boolean;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** A reusable AI persona/workflow (Claude/Codex-style custom agent). */
export interface AgentDoc {
  id: string;
  name: string;
  description: string;
  /** Emoji or single character used as the avatar glyph. */
  avatar?: string;
  systemPrompt: string;
  defaultModel?: ForgeModelId;
  defaultEffort?: EffortId;
  defaultThinking?: boolean;
  /** Skills auto-activated when this agent is selected. */
  skillSlugs?: string[];
  allowedTools?: string[];
  defaultProjectId?: string | null;
  enabled: boolean;
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

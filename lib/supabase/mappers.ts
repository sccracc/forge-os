import "server-only";

// Central translation layer between the app's camelCase domain objects and the
// snake_case Supabase rows. ALL shape/naming differences live here so the rest
// of the app keeps speaking the existing `*Doc` types unchanged.
//
// Timestamps: the app uses epoch-ms numbers; the DB uses `timestamptz`. We
// convert at this boundary (msToIso / isoToMs).

import type {
  ConversationDoc,
  MessageDoc,
  ProjectDoc,
  FileDoc,
  Skill,
  AgentDoc,
  CheckpointDoc,
  CheckpointFile,
  UserProfile,
  PreviewKind,
  Role,
  SkillRef,
  AgentRef,
  MessageSearch,
} from "@/lib/data/types";
import type { BuildMessage } from "@/lib/data/build-chat";
import type { ForgeModelId } from "@/lib/ai/models.public";
import type { EffortId } from "@/lib/ai/effort";
import { normalizeMessageAttachments } from "@/lib/data/attachments";

export type Row = Record<string, unknown>;

// ---------- primitive coercion ----------
const str = (v: unknown): string | undefined =>
  v == null ? undefined : String(v);
const num = (v: unknown): number | undefined =>
  v == null ? undefined : Number(v);
const bool = (v: unknown): boolean | undefined =>
  v == null ? undefined : Boolean(v);

export const msToIso = (ms: number | null | undefined): string | null =>
  ms == null ? null : new Date(ms).toISOString();
export const isoToMs = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
};

/** Drop undefined values so partial updates only touch provided columns. */
function compact(o: Row): Row {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

// ============================================================================
// Conversations
// ============================================================================
export function rowToConversation(r: Row): ConversationDoc {
  return {
    id: String(r.id),
    title: str(r.title) ?? "New chat",
    createdAt: isoToMs(r.created_at),
    updatedAt: isoToMs(r.updated_at),
    projectId: (str(r.project_id) ?? null) as string | null,
    model: str(r.model) as ForgeModelId,
    effort: str(r.effort) as EffortId,
    thinking: bool(r.thinking) ?? false,
    pinned: bool(r.pinned),
    agentId: (str(r.agent_id) ?? null) as string | null,
    activeLeafId: (str(r.active_leaf_id) ?? null) as string | null,
  };
}

export function conversationToInsert(c: ConversationDoc, uid: string): Row {
  return compact({
    id: c.id,
    user_id: uid,
    title: c.title,
    project_id: c.projectId ?? null,
    model: c.model ?? null,
    effort: c.effort ?? null,
    thinking: c.thinking ?? false,
    agent_id: c.agentId ?? null,
    active_leaf_id: c.activeLeafId ?? null,
    pinned: c.pinned ?? null,
    created_at: msToIso(c.createdAt),
    updated_at: msToIso(c.updatedAt),
  });
}

export function conversationPatchToUpdate(p: Partial<ConversationDoc>): Row {
  const u: Row = {};
  if ("title" in p) u.title = p.title;
  if ("projectId" in p) u.project_id = p.projectId;
  if ("model" in p) u.model = p.model;
  if ("effort" in p) u.effort = p.effort;
  if ("thinking" in p) u.thinking = p.thinking;
  if ("pinned" in p) u.pinned = p.pinned;
  if ("agentId" in p) u.agent_id = p.agentId;
  if ("activeLeafId" in p) u.active_leaf_id = p.activeLeafId;
  if ("updatedAt" in p) u.updated_at = msToIso(p.updatedAt);
  return u;
}

// ============================================================================
// Messages   (app `reasoning` -> thinking_content; `thinking` -> thinking_enabled)
// ============================================================================
export function rowToMessage(r: Row): MessageDoc {
  return {
    id: String(r.id),
    role: String(r.role) as Role,
    content: str(r.content) ?? "",
    reasoning: str(r.thinking_content),
    reasoningMs: num(r.reasoning_ms),
    parentId: (str(r.parent_id) ?? null) as string | null,
    createdAt: isoToMs(r.created_at),
    model: str(r.model) as ForgeModelId | undefined,
    effort: str(r.effort) as EffortId | undefined,
    thinking: bool(r.thinking_enabled),
    tokens: num(r.tokens),
    realTokensUsed: num(r.real_tokens_used),
    forgeTokensDeducted: num(r.forge_tokens_deducted),
    multiplierUsed: num(r.multiplier_used),
    hadToolCall: bool(r.had_tool_call),
    error: bool(r.error),
    skillsUsed: (r.skills_used as SkillRef[] | null) ?? undefined,
    agentUsed: (r.agent_used as AgentRef | null) ?? undefined,
    searches: (r.searches as MessageSearch[] | null) ?? undefined,
    attachments: normalizeMessageAttachments(r.attachments),
  };
}

export function messageToInsert(
  m: MessageDoc,
  uid: string,
  conversationId: string
): Row {
  return compact({
    id: m.id,
    conversation_id: conversationId,
    user_id: uid,
    role: m.role,
    content: m.content ?? "",
    thinking_content: m.reasoning ?? null,
    reasoning_ms: m.reasoningMs ?? null,
    parent_id: m.parentId ?? null,
    model: m.model ?? null,
    effort: m.effort ?? null,
    thinking_enabled: m.thinking ?? null,
    tokens: m.tokens ?? null,
    real_tokens_used: m.realTokensUsed ?? null,
    forge_tokens_deducted: m.forgeTokensDeducted ?? null,
    multiplier_used: m.multiplierUsed ?? null,
    had_tool_call: m.hadToolCall ?? null,
    error: m.error ?? null,
    skills_used: m.skillsUsed ?? null,
    agent_used: m.agentUsed ?? null,
    // Omitted when absent (compact drops undefined) so message inserts still work
    // before the `searches` column migration is run; only set when a search ran.
    searches: m.searches,
    attachments: m.attachments ?? null,
    created_at: msToIso(m.createdAt),
  });
}

export function messagePatchToUpdate(p: Partial<MessageDoc>): Row {
  const u: Row = {};
  if ("content" in p) u.content = p.content;
  if ("reasoning" in p) u.thinking_content = p.reasoning;
  if ("reasoningMs" in p) u.reasoning_ms = p.reasoningMs;
  if ("model" in p) u.model = p.model;
  if ("effort" in p) u.effort = p.effort;
  if ("thinking" in p) u.thinking_enabled = p.thinking;
  if ("tokens" in p) u.tokens = p.tokens;
  if ("realTokensUsed" in p) u.real_tokens_used = p.realTokensUsed;
  if ("forgeTokensDeducted" in p) u.forge_tokens_deducted = p.forgeTokensDeducted;
  if ("multiplierUsed" in p) u.multiplier_used = p.multiplierUsed;
  if ("hadToolCall" in p) u.had_tool_call = p.hadToolCall;
  if ("error" in p) u.error = p.error;
  if ("skillsUsed" in p) u.skills_used = p.skillsUsed;
  if ("agentUsed" in p) u.agent_used = p.agentUsed;
  if ("searches" in p) u.searches = p.searches;
  if ("attachments" in p) u.attachments = p.attachments ?? null;
  return u;
}

// ============================================================================
// Projects
// ============================================================================
export function rowToProject(r: Row): ProjectDoc {
  return {
    id: String(r.id),
    name: str(r.name) ?? "Untitled project",
    description: str(r.description),
    language: str(r.language) ?? "",
    starter: str(r.starter) ?? "blank",
    previewMode: (str(r.preview_mode) ?? "none") as PreviewKind,
    gradient: ((r.gradient as string[] | null) ?? ["#6366f1", "#8b5cf6"]) as [
      string,
      string,
    ],
    fileCount: num(r.file_count) ?? 0,
    forgeMd: str(r.forge_md),
    published: (r.published as ProjectDoc["published"]) ?? undefined,
    createdAt: isoToMs(r.created_at),
    updatedAt: isoToMs(r.updated_at),
  };
}

export function projectToInsert(p: ProjectDoc, uid: string): Row {
  return compact({
    id: p.id,
    user_id: uid,
    name: p.name,
    description: p.description ?? null,
    language: p.language ?? null,
    starter: p.starter ?? null,
    preview_mode: p.previewMode ?? null,
    gradient: p.gradient ?? null,
    file_count: p.fileCount ?? 0,
    forge_md: p.forgeMd ?? null,
    published: p.published ?? null,
    created_at: msToIso(p.createdAt),
    updated_at: msToIso(p.updatedAt),
  });
}

export function projectPatchToUpdate(p: Partial<ProjectDoc>): Row {
  const u: Row = {};
  if ("name" in p) u.name = p.name;
  if ("description" in p) u.description = p.description;
  if ("language" in p) u.language = p.language;
  if ("starter" in p) u.starter = p.starter;
  if ("previewMode" in p) u.preview_mode = p.previewMode;
  if ("gradient" in p) u.gradient = p.gradient;
  if ("fileCount" in p) u.file_count = p.fileCount;
  if ("forgeMd" in p) u.forge_md = p.forgeMd;
  if ("published" in p) u.published = p.published;
  if ("updatedAt" in p) u.updated_at = msToIso(p.updatedAt);
  return u;
}

// ============================================================================
// Files   (app `storagePath` -> storage_url)
// ============================================================================
export function rowToFile(r: Row): FileDoc {
  return {
    id: String(r.id),
    name: str(r.name) ?? "",
    path: str(r.path) ?? "",
    parentId: (str(r.parent_id) ?? null) as string | null,
    projectId: (str(r.project_id) ?? null) as string | null,
    kind: (str(r.kind) ?? "file") as FileDoc["kind"],
    category: str(r.category) as FileDoc["category"] | undefined,
    language: str(r.language),
    mime: str(r.mime),
    size: num(r.size) ?? 0,
    content: str(r.content),
    storagePath: str(r.storage_url),
    chunked: bool(r.chunked),
    createdAt: isoToMs(r.created_at),
    updatedAt: isoToMs(r.updated_at),
  };
}

export function fileToInsert(f: FileDoc, uid: string): Row {
  return compact({
    id: f.id,
    user_id: uid,
    name: f.name,
    path: f.path,
    parent_id: f.parentId ?? null,
    project_id: f.projectId ?? null,
    kind: f.kind ?? null,
    category: f.category ?? null,
    language: f.language ?? null,
    mime: f.mime ?? null,
    size: f.size ?? 0,
    content: f.content ?? null,
    storage_url: f.storagePath ?? null,
    chunked: f.chunked ?? null,
    created_at: msToIso(f.createdAt),
    updated_at: msToIso(f.updatedAt),
  });
}

export function filePatchToUpdate(p: Partial<FileDoc>): Row {
  const u: Row = {};
  if ("name" in p) u.name = p.name;
  if ("path" in p) u.path = p.path;
  if ("parentId" in p) u.parent_id = p.parentId;
  if ("projectId" in p) u.project_id = p.projectId;
  if ("kind" in p) u.kind = p.kind;
  if ("category" in p) u.category = p.category;
  if ("language" in p) u.language = p.language;
  if ("mime" in p) u.mime = p.mime;
  if ("size" in p) u.size = p.size;
  if ("content" in p) u.content = p.content;
  if ("storagePath" in p) u.storage_url = p.storagePath;
  if ("chunked" in p) u.chunked = p.chunked;
  if ("updatedAt" in p) u.updated_at = msToIso(p.updatedAt);
  return u;
}

// ============================================================================
// Skills   (app `enabled` -> is_active; `builtin` -> is_builtin)
// ============================================================================
export function rowToSkill(r: Row): Skill {
  return {
    id: String(r.id),
    name: str(r.name) ?? "Untitled skill",
    slug: str(r.slug) ?? "",
    description: str(r.description) ?? "",
    instructions: str(r.instructions) ?? "",
    enabled: bool(r.is_active) ?? true,
    builtin: bool(r.is_builtin),
    icon: str(r.icon),
    category: str(r.category),
    version: num(r.version),
    files: (r.files as Skill["files"]) ?? undefined,
    favorite: bool(r.favorite),
    lastUsedAt: r.last_used_at != null ? isoToMs(r.last_used_at) : undefined,
    createdAt: isoToMs(r.created_at),
    updatedAt: isoToMs(r.updated_at),
  };
}

export function skillToInsert(s: Skill, uid: string): Row {
  return compact({
    id: s.id,
    user_id: uid,
    name: s.name,
    slug: s.slug,
    description: s.description ?? null,
    instructions: s.instructions ?? null,
    is_active: s.enabled ?? true,
    is_builtin: s.builtin ?? false,
    icon: s.icon ?? null,
    category: s.category ?? null,
    version: s.version ?? 1,
    files: s.files ?? null,
    favorite: s.favorite ?? null,
    last_used_at: msToIso(s.lastUsedAt),
    created_at: msToIso(s.createdAt),
    updated_at: msToIso(s.updatedAt),
  });
}

export function skillPatchToUpdate(p: Partial<Skill>): Row {
  const u: Row = {};
  if ("name" in p) u.name = p.name;
  if ("slug" in p) u.slug = p.slug;
  if ("description" in p) u.description = p.description;
  if ("instructions" in p) u.instructions = p.instructions;
  if ("enabled" in p) u.is_active = p.enabled;
  if ("builtin" in p) u.is_builtin = p.builtin;
  if ("icon" in p) u.icon = p.icon;
  if ("category" in p) u.category = p.category;
  if ("version" in p) u.version = p.version;
  if ("files" in p) u.files = p.files;
  if ("favorite" in p) u.favorite = p.favorite;
  if ("lastUsedAt" in p) u.last_used_at = msToIso(p.lastUsedAt);
  if ("updatedAt" in p) u.updated_at = msToIso(p.updatedAt);
  return u;
}

// ============================================================================
// Agents
// ============================================================================
export function rowToAgent(r: Row): AgentDoc {
  return {
    id: String(r.id),
    name: str(r.name) ?? "Untitled agent",
    description: str(r.description) ?? "",
    avatar: str(r.avatar),
    systemPrompt: str(r.system_prompt) ?? "",
    defaultModel: str(r.default_model) as ForgeModelId | undefined,
    defaultEffort: str(r.default_effort) as EffortId | undefined,
    defaultThinking: bool(r.default_thinking),
    skillSlugs: (r.skill_slugs as string[] | null) ?? undefined,
    allowedTools: (r.allowed_tools as string[] | null) ?? undefined,
    defaultProjectId: (str(r.default_project_id) ?? null) as string | null,
    enabled: bool(r.enabled) ?? true,
    builtin: bool(r.is_builtin),
    createdAt: isoToMs(r.created_at),
    updatedAt: isoToMs(r.updated_at),
  };
}

export function agentToInsert(a: AgentDoc, uid: string): Row {
  return compact({
    id: a.id,
    user_id: uid,
    name: a.name,
    description: a.description ?? null,
    avatar: a.avatar ?? null,
    system_prompt: a.systemPrompt ?? null,
    default_model: a.defaultModel ?? null,
    default_effort: a.defaultEffort ?? null,
    default_thinking: a.defaultThinking ?? null,
    skill_slugs: a.skillSlugs ?? null,
    allowed_tools: a.allowedTools ?? null,
    default_project_id: a.defaultProjectId ?? null,
    enabled: a.enabled ?? true,
    is_builtin: a.builtin ?? false,
    created_at: msToIso(a.createdAt),
    updated_at: msToIso(a.updatedAt),
  });
}

export function agentPatchToUpdate(p: Partial<AgentDoc>): Row {
  const u: Row = {};
  if ("name" in p) u.name = p.name;
  if ("description" in p) u.description = p.description;
  if ("avatar" in p) u.avatar = p.avatar;
  if ("systemPrompt" in p) u.system_prompt = p.systemPrompt;
  if ("defaultModel" in p) u.default_model = p.defaultModel;
  if ("defaultEffort" in p) u.default_effort = p.defaultEffort;
  if ("defaultThinking" in p) u.default_thinking = p.defaultThinking;
  if ("skillSlugs" in p) u.skill_slugs = p.skillSlugs;
  if ("allowedTools" in p) u.allowed_tools = p.allowedTools;
  if ("defaultProjectId" in p) u.default_project_id = p.defaultProjectId;
  if ("enabled" in p) u.enabled = p.enabled;
  if ("builtin" in p) u.is_builtin = p.builtin;
  if ("updatedAt" in p) u.updated_at = msToIso(p.updatedAt);
  return u;
}

// ============================================================================
// Checkpoints
// ============================================================================
export function rowToCheckpoint(r: Row): CheckpointDoc {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    label: str(r.label) ?? "Checkpoint",
    kind: (str(r.kind) ?? "manual") as CheckpointDoc["kind"],
    at: isoToMs(r.at),
    fileCount: num(r.file_count) ?? 0,
    files: ((r.files as CheckpointFile[] | null) ?? []) as CheckpointFile[],
  };
}

export function checkpointToInsert(c: CheckpointDoc, uid: string): Row {
  return compact({
    id: c.id,
    user_id: uid,
    project_id: c.projectId,
    label: c.label,
    kind: c.kind,
    at: msToIso(c.at),
    file_count: c.fileCount,
    files: c.files,
  });
}

// ============================================================================
// Build log
// ============================================================================
export function rowToBuildMessage(r: Row): BuildMessage {
  return {
    id: String(r.id),
    role: String(r.role) as BuildMessage["role"],
    content: str(r.content) ?? "",
    createdAt: isoToMs(r.created_at),
    files: (r.files as BuildMessage["files"]) ?? undefined,
    skillsUsed: (r.skills_used as SkillRef[] | null) ?? undefined,
    agentRun: (r.agent_run as BuildMessage["agentRun"]) ?? undefined,
    error: bool(r.error),
  };
}

export function buildMessageToInsert(
  m: BuildMessage,
  uid: string,
  projectId: string
): Row {
  return compact({
    id: m.id,
    user_id: uid,
    project_id: projectId,
    role: m.role,
    content: m.content ?? null,
    files: m.files ?? null,
    skills_used: m.skillsUsed ?? null,
    agent_run: m.agentRun ?? null,
    error: m.error ?? null,
    created_at: msToIso(m.createdAt),
  });
}

export function buildMessagePatchToUpdate(p: Partial<BuildMessage>): Row {
  const u: Row = {};
  if ("content" in p) u.content = p.content;
  if ("files" in p) u.files = p.files;
  if ("skillsUsed" in p) u.skills_used = p.skillsUsed;
  if ("agentRun" in p) u.agent_run = p.agentRun;
  if ("error" in p) u.error = p.error;
  return u;
}

// ============================================================================
// Profile  (UserProfile  <->  users + user_settings)
// ============================================================================
export function rowsToProfile(userRow: Row, settingsRow: Row | null): UserProfile {
  const s = settingsRow ?? {};
  return {
    uid: String(userRow.id),
    displayName: str(userRow.name),
    email: str(userRow.email),
    photoURL: str(userRow.avatar_url),
    plan: str(userRow.plan) ?? "free",
    defaultModel: (str(s.default_model) ?? "spark-2.5") as ForgeModelId,
    defaultEffort: (str(s.default_effort) ?? "low") as EffortId,
    defaultThinking: bool(s.default_thinking) ?? false,
    defaultToolsEnabled: bool(s.default_tools_enabled) ?? false,
    defaultPreviewMode: (str(s.default_preview_mode) ??
      "auto") as UserProfile["defaultPreviewMode"],
    buildAutonomy: (str(s.build_autonomy) ??
      "auto") as UserProfile["buildAutonomy"],
    customAbout: str(s.custom_instructions_about) ?? "",
    customStyle: str(s.custom_instructions_style) ?? "",
    memoryEnabled: bool(s.memory_enabled) ?? true,
    searchChatsEnabled: bool(s.search_chats_enabled) ?? true,
    memoryProfile: str(s.memory_profile) ?? "",
    skillsSeeded: bool(s.skills_seeded),
    createdAt: isoToMs(userRow.created_at),
    updatedAt: isoToMs(userRow.updated_at),
  };
}

/** Split a profile patch into the columns of each backing table. */
export function profilePatchToRows(p: Partial<UserProfile>): {
  users: Row;
  settings: Row;
} {
  const users: Row = {};
  const settings: Row = {};
  if ("displayName" in p) users.name = p.displayName;
  // `email` is deliberately NOT patchable here: it is provisioned from the
  // verified Firebase token via /api/auth/sync-user only. Letting a client
  // PATCH it would allow arbitrary/colliding emails in the users table.
  if ("photoURL" in p) users.avatar_url = p.photoURL;

  if ("defaultModel" in p) settings.default_model = p.defaultModel;
  if ("defaultEffort" in p) settings.default_effort = p.defaultEffort;
  if ("defaultThinking" in p) settings.default_thinking = p.defaultThinking;
  if ("defaultToolsEnabled" in p)
    settings.default_tools_enabled = p.defaultToolsEnabled;
  if ("defaultPreviewMode" in p)
    settings.default_preview_mode = p.defaultPreviewMode;
  if ("buildAutonomy" in p) settings.build_autonomy = p.buildAutonomy;
  if ("customAbout" in p) settings.custom_instructions_about = p.customAbout;
  if ("customStyle" in p) settings.custom_instructions_style = p.customStyle;
  if ("memoryEnabled" in p) settings.memory_enabled = p.memoryEnabled;
  if ("searchChatsEnabled" in p)
    settings.search_chats_enabled = p.searchChatsEnabled;
  if ("memoryProfile" in p) settings.memory_profile = p.memoryProfile;
  if ("skillsSeeded" in p) settings.skills_seeded = p.skillsSeeded;
  return { users, settings };
}

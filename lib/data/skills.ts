"use client";

import { api } from "./authed-fetch";
import { pollingSubscribe, invalidate } from "./realtime";
import { uid as genId } from "@/lib/utils";
import type { Skill } from "./types";
import { BUILTIN_SKILLS } from "@/lib/skills/builtins";

const skillsKey = (uid: string) => `skills:${uid}`;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "skill"
  );
}

function listSkills(): Promise<Skill[]> {
  return api.get<Skill[]>("/api/data/skills");
}

async function uniqueSlug(uid: string, base: string, ignoreId?: string): Promise<string> {
  const all = await listSkills();
  const taken = new Set(all.filter((s) => s.id !== ignoreId).map((s) => s.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function subscribeSkills(
  uid: string,
  cb: (skills: Skill[]) => void,
  onError?: (e: Error) => void
): () => void {
  return pollingSubscribe<Skill[]>(skillsKey(uid), listSkills, cb, onError);
}

export interface SkillInit {
  name: string;
  description?: string;
  instructions: string;
  slug?: string;
  icon?: string;
  category?: string;
  enabled?: boolean;
  builtin?: boolean;
  files?: Skill["files"];
}

export async function createSkill(uid: string, init: SkillInit): Promise<string> {
  const id = genId("skill");
  const now = Date.now();
  const base = slugify(init.slug || init.name);
  const slug = await uniqueSlug(uid, base);
  const skill: Skill = {
    id,
    name: init.name.trim() || "Untitled skill",
    slug,
    description: (init.description ?? "").trim(),
    instructions: init.instructions ?? "",
    enabled: init.enabled ?? true,
    builtin: init.builtin,
    icon: init.icon,
    category: init.category,
    version: 1,
    files: init.files,
    createdAt: now,
    updatedAt: now,
  };
  await api.post("/api/data/skills", skill);
  invalidate(skillsKey(uid));
  return id;
}

export async function updateSkill(
  uid: string,
  id: string,
  patch: Partial<Skill>
): Promise<void> {
  const next: Partial<Skill> = { ...patch, updatedAt: Date.now() };
  // Slug stays stable on rename unless the user explicitly changes it.
  if (patch.slug) next.slug = await uniqueSlug(uid, slugify(patch.slug), id);
  if (typeof patch.version === "undefined") {
    const cur = (await listSkills()).find((s) => s.id === id);
    next.version = (cur?.version ?? 1) + 1;
  }
  await api.patch(`/api/data/skills/${id}`, next);
  invalidate(skillsKey(uid));
}

export async function deleteSkill(uid: string, id: string): Promise<void> {
  await api.del(`/api/data/skills/${id}`);
  invalidate(skillsKey(uid));
}

export async function duplicateSkill(uid: string, id: string): Promise<string> {
  const s = (await listSkills()).find((x) => x.id === id);
  if (!s) throw new Error("Skill not found");
  return createSkill(uid, {
    name: `${s.name} (copy)`,
    description: s.description,
    instructions: s.instructions,
    icon: s.icon,
    category: s.category,
    enabled: s.enabled,
    files: s.files,
  });
}

export async function setSkillEnabled(
  uid: string,
  id: string,
  enabled: boolean
): Promise<void> {
  await api.patch(`/api/data/skills/${id}`, { enabled, updatedAt: Date.now() });
  invalidate(skillsKey(uid));
}

export async function setSkillFavorite(
  uid: string,
  id: string,
  favorite: boolean
): Promise<void> {
  await api.patch(`/api/data/skills/${id}`, { favorite, updatedAt: Date.now() });
  invalidate(skillsKey(uid));
}

export async function touchSkillUsed(uid: string, slug: string): Promise<void> {
  const match = (await listSkills()).find((s) => s.slug === slug);
  if (match) {
    await api.patch(`/api/data/skills/${match.id}`, { lastUsedAt: Date.now() }).catch(() => {});
    invalidate(skillsKey(uid));
  }
}

/** Seeds the built-in skills (idempotent by slug). Caller gates with a flag. */
export async function ensureBuiltinSkills(uid: string): Promise<void> {
  const existing = new Set((await listSkills()).map((s) => s.slug));
  const now = Date.now();
  await Promise.all(
    BUILTIN_SKILLS.filter((b) => !existing.has(b.slug)).map((b) => {
      const id = genId("skill");
      const skill: Skill = {
        id,
        name: b.name,
        slug: b.slug,
        description: b.description,
        instructions: b.instructions,
        enabled: b.enabled,
        builtin: true,
        icon: b.icon,
        category: b.category,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      return api.post("/api/data/skills", skill);
    })
  );
  invalidate(skillsKey(uid));
}

export function exportSkill(s: Skill): string {
  return JSON.stringify(
    {
      name: s.name,
      slug: s.slug,
      description: s.description,
      instructions: s.instructions,
      icon: s.icon,
      category: s.category,
      files: s.files,
    },
    null,
    2
  );
}

interface ImportedSkill {
  name?: string;
  slug?: string;
  description?: string;
  instructions?: string;
  icon?: string;
  category?: string;
  files?: Skill["files"];
}

/** Imports one or many skills from a JSON string. Returns the count created. */
export async function importSkills(uid: string, json: string): Promise<number> {
  const parsed = JSON.parse(json) as ImportedSkill | ImportedSkill[];
  const list = Array.isArray(parsed) ? parsed : [parsed];
  let count = 0;
  for (const item of list) {
    if (!item || !item.name || !item.instructions) continue;
    await createSkill(uid, {
      name: item.name,
      slug: item.slug,
      description: item.description,
      instructions: item.instructions,
      icon: item.icon,
      category: item.category,
      enabled: true,
      files: item.files,
    });
    count++;
  }
  return count;
}

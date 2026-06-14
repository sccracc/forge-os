"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useComposerStore } from "@/lib/store/composer-store";
import {
  useStreamStore,
  setController,
  abortController,
  clearController,
} from "@/lib/store/stream-store";
import {
  createConversation,
  addMessage,
  updateConversation,
} from "@/lib/data/chat";
import type { ThreadNode } from "@/lib/data/tree";
import type { WireMessage, StreamEventWire } from "@/lib/ai/types";
import type { ForgeModelId } from "@/lib/ai/models.public";
import type { EffortId } from "@/lib/ai/effort";
import { useSkills } from "@/hooks/use-skills";
import { useAgents } from "@/hooks/use-agents";
import { touchSkillUsed } from "@/lib/data/skills";
import { detectCreatorIntent } from "@/lib/ai/intent";
import { SKILL_CREATOR_SLUG, AGENT_CREATOR_SLUG } from "@/lib/skills/builtins";
import { useSuggestionStore } from "@/lib/store/suggestion-store";
import {
  buildSkillSuggestionPrompt,
  type SuggestedSkill,
} from "@/lib/ai/skill-suggestions";
import type {
  AgentDoc,
  AgentRef,
  MessageAttachment,
  MessageGeneratedImageAttachment,
  OutgoingAttachments,
  Skill,
  SkillRef,
} from "@/lib/data/types";
import { toast } from "@/lib/store/toast-store";
import { useUsageStore } from "@/lib/store/usage-store";
import { getImageAttachments } from "@/lib/data/attachments";
import { uid as genId } from "@/lib/utils";

interface ActiveSkillPayload {
  name: string;
  instructions: string;
}
interface SkillCatalogEntry {
  name: string;
  slug: string;
  description?: string;
}

/** {id, name, avatar} of the active agent — for the "responding as …" badge. */
function resolveAgentMeta(agentId: string | null, agents: AgentDoc[]): AgentRef | null {
  if (!agentId) return null;
  const a = agents.find((x) => x.id === agentId);
  return a ? { id: a.id, name: a.name, avatar: a.avatar } : null;
}

/** Deferred run args, held while we ask the user about suggested skills. */
const pendingRuns = new Map<string, { args: RunArgs; suggestedSlugs?: string[] }>();

/** Conservative pre-pass: does any of the user's skills clearly fit this turn? */
async function fetchSuggestion(
  getIdToken: () => Promise<string | null>,
  message: string,
  candidates: SkillCatalogEntry[]
): Promise<SuggestedSkill[]> {
  try {
    const token = await getIdToken();
    if (!token) return [];
    const res = await fetch("/api/suggest-skill", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message,
        skills: candidates.map((c) => ({ slug: c.slug, name: c.name, description: c.description })),
      }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      skills?: SuggestedSkill[];
      slug?: string | null;
      name?: string;
      reason?: string;
    };
    const raw = Array.isArray(j.skills)
      ? j.skills
      : j.slug
        ? [{ slug: j.slug, name: j.name ?? j.slug, reason: j.reason ?? "" }]
        : [];
    const bySlug = new Map(candidates.map((candidate) => [candidate.slug, candidate]));
    const seen = new Set<string>();
    return raw
      .map((skill) => {
        const candidate = bySlug.get(skill.slug);
        if (!candidate || seen.has(candidate.slug)) return null;
        seen.add(candidate.slug);
        return {
          slug: candidate.slug,
          name: skill.name || candidate.name,
          reason: skill.reason || "",
        };
      })
      .filter((skill): skill is SuggestedSkill => Boolean(skill));
  } catch {
    return [];
  }
}

async function fetchConversationTitle(
  getIdToken: () => Promise<string | null>,
  firstUserMessage: string
): Promise<string | null> {
  try {
    const token = await getIdToken();
    if (!token) return null;
    const res = await fetch("/api/title", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ firstUserMessage }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: string };
    return j.title?.trim() || null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Full skill catalog (name + slug + description) so the model can edit by slug. */
function buildSkillCatalog(all: Skill[]): SkillCatalogEntry[] {
  return all.map((s) => ({
    name: s.name,
    slug: s.slug,
    description: s.description || undefined,
  }));
}

/** {name, slug} of active skills — for the "Reading … SKILL.md" indicator. */
function resolveSkillMeta(slugs: string[], all: Skill[]): SkillRef[] {
  return slugs
    .map((slug) => all.find((s) => s.slug === slug && s.enabled))
    .filter((s): s is Skill => Boolean(s))
    .map((s) => ({ name: s.name, slug: s.slug }));
}

/** Resolve active slugs → ordered skill payloads (activation order preserved). */
function resolveSkills(slugs: string[], all: Skill[]): ActiveSkillPayload[] {
  return slugs
    .map((slug) => all.find((s) => s.slug === slug && s.enabled))
    .filter((s): s is Skill => Boolean(s))
    .map((s) => ({ name: s.name, instructions: s.instructions }));
}

/** Map streamed searches → the compact shape persisted on the message. */
function donePersistedSearches(
  searches?: { query: string; done: boolean; count?: number; sources?: { title: string; url: string }[] }[]
) {
  const list = (searches ?? []).filter((s) => s.done);
  return list.length
    ? list.map((s) => ({ query: s.query, count: s.count ?? 0, sources: s.sources ?? [] }))
    : undefined;
}

function doneGeneratedImageAttachments(
  images?: {
    done: boolean;
    imageUrl?: string;
    prompt?: string;
    notice?: string;
  }[]
): MessageGeneratedImageAttachment[] | undefined {
  const list = (images ?? [])
    .filter((image) => image.done && image.imageUrl && image.prompt)
    .map((image) => ({
      type: "generated_image" as const,
      imageUrl: image.imageUrl!,
      prompt: image.prompt!,
      ...(image.notice ? { notice: image.notice } : {}),
    }));
  return list.length ? list : undefined;
}

function doneAssistantAttachments(st?: {
  generatedImages?: Parameters<typeof doneGeneratedImageAttachments>[0];
}) {
  return doneGeneratedImageAttachments(st?.generatedImages);
}

function toWire(nodes: ThreadNode[]): WireMessage[] {
  return nodes
    .filter((n) => n.role === "user" || n.role === "assistant")
    .map((n) => ({
      role: n.role as "user" | "assistant",
      content: n.content,
      reasoningContent: n.hadToolCall ? n.reasoning : undefined,
      hadToolCall: n.hadToolCall,
    }));
}

interface RunArgs {
  uid: string;
  cid: string;
  parentId: string;
  parentLeafId: string | null;
  userMessageContent: string;
  wire: WireMessage[];
  settings: { model: ForgeModelId; effort: EffortId; thinking: boolean };
  toolsEnabled: boolean;
  skillSlugs: string[];
  skills: ActiveSkillPayload[];
  skillCatalog: SkillCatalogEntry[];
  skillMeta: SkillRef[];
  agentId: string | null;
  agentMeta: AgentRef | null;
  incognito: boolean;
  conversationTitle?: string | null;
  titleIsDefault: boolean;
  /** Images/documents to send to the model this turn. */
  attachments: OutgoingAttachments;
  /** Image + document chips for the optimistic user bubble. */
  persistedAttachments?: MessageAttachment[];
  /** Resolves once the conversation + user message are persisted (Part F). */
  persistence?: Promise<void>;
  getIdToken: () => Promise<string | null>;
}

/** Map the outgoing attachments to the /api/chat request body shape. */
function attachmentsToBody(a: OutgoingAttachments) {
  return {
    attachedImages: a.images.length
      ? a.images.map((i) => ({ base64: i.base64, mimeType: i.mimeType }))
      : undefined,
    documents: a.documents.length ? a.documents : undefined,
    scannedPdfs: a.scannedPdfs.length ? a.scannedPdfs : undefined,
  };
}

export function useChatController() {
  const { user, getIdToken } = useAuth();
  const router = useRouter();
  const { skills: allSkills } = useSkills();
  const { agents } = useAgents();
  const start = useStreamStore((s) => s.start);
  const appendContent = useStreamStore((s) => s.appendContent);
  const appendReasoning = useStreamStore((s) => s.appendReasoning);
  const setPhase = useStreamStore((s) => s.setPhase);
  const upsertSearch = useStreamStore((s) => s.upsertSearch);
  const upsertGeneratedImage = useStreamStore((s) => s.upsertGeneratedImage);
  const clear = useStreamStore((s) => s.clear);

  const runStream = useCallback(
    async (args: RunArgs, options?: { reuseExisting?: boolean }) => {
      const { uid, cid, parentId, wire, settings } = args;
      const existing = useStreamStore.getState().byConv[cid];
      if (options?.reuseExisting && existing) {
        setPhase(cid, settings.thinking ? "reasoning" : "streaming", {
          content: "",
          reasoning: "",
          reasoningStart: Date.now(),
          reasoningFirstAt: undefined,
          reasoningMs: undefined,
          activeSkills: args.skillMeta,
          activeAgent: args.agentMeta ?? undefined,
          searches: undefined,
          generatedImages: undefined,
        });
      } else {
        start({
          conversationId: cid,
          userMessageId: parentId,
          userMessageContent: args.userMessageContent,
          userMessageAttachments: args.persistedAttachments,
          userMessageParentId: args.parentLeafId,
          content: "",
          reasoning: "",
          phase: settings.thinking ? "reasoning" : "streaming",
          reasoningStart: Date.now(),
          model: settings.model,
          effort: settings.effort,
          thinking: settings.thinking,
          activeSkills: args.skillMeta,
          activeAgent: args.agentMeta ?? undefined,
        });
      }

      const token = await args.getIdToken();
      if (!token) {
        setPhase(cid, "error", { error: "Your session expired. Please sign in again." });
        return;
      }

      const ac = new AbortController();
      setController(cid, ac);
      let tokens = 0;
      let realTokens: number | undefined;
      let forgeTokens: number | undefined;
      let multiplier: number | undefined;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            messages: wire,
            forgeModelId: settings.model,
            effort: settings.effort,
            thinking: settings.thinking,
            mode: "chat",
            conversationId: cid,
            conversationTitle: args.conversationTitle ?? undefined,
            toolsEnabled: args.toolsEnabled,
            skillSlugs: args.skillSlugs,
            skills: args.skills,
            skillCatalog: args.skillCatalog,
            agentId: args.agentId ?? undefined,
            incognito: args.incognito,
            webSearch: useComposerStore.getState().webSearchEnabled,
            ...attachmentsToBody(args.attachments),
            wantTitle: false,
          }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => null)) as
            | {
                error?: string;
                message?: string;
                reason?: string;
                resetsAt?: string;
                requiredPlan?: string;
                feature?: string;
              }
            | null;
          // Usage limit (§STEP 4): show the dedicated modal, not an inline error.
          if (res.status === 429 && j?.error === "usage_limit") {
            useUsageStore.getState().openLimit({
              message: j.message,
              reason: j.reason,
              resetsAt: j.resetsAt ? Date.parse(j.resetsAt) : null,
            });
            void useUsageStore.getState().refresh();
            clear(cid); // remove the streaming bubble; user message stays for retry
            clearController(cid);
            return;
          }
          // Plan gate (§STEP 4): "Feature Locked" upgrade modal.
          if (res.status === 403 && j?.error === "plan_gate") {
            useUsageStore.getState().openGate({
              message: j.message,
              requiredPlan: j.requiredPlan,
              feature: j.feature,
            });
            clear(cid);
            clearController(cid);
            return;
          }
          let msg = "Forge couldn't respond. Please try again.";
          if (j?.error) msg = j.error;
          else if (res.status === 401) msg = "Your session expired. Please sign in again.";
          else if (res.status === 429) msg = "Forge is busy, try again shortly.";
          setPhase(cid, "error", { error: msg });
          clearController(cid);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev: StreamEventWire;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            if (ev.t === "content") appendContent(cid, ev.d);
            else if (ev.t === "reasoning") appendReasoning(cid, ev.d);
            else if (ev.t === "status")
              upsertSearch(cid, {
                id: ev.id ?? "search",
                query: ev.d,
                done: !!ev.done,
                count: ev.n,
                sources: ev.sources,
              });
            else if (ev.t === "image")
              upsertGeneratedImage(cid, {
                id: ev.id,
                loadingText: ev.loadingText ?? "Generating your image...",
                done: !!ev.done,
                imageUrl: ev.imageUrl,
                prompt: ev.prompt,
                error: ev.error,
                notice: ev.notice,
              });
            else if (ev.t === "done") {
              tokens = ev.tokens;
              realTokens = ev.realTokens;
              forgeTokens = ev.forgeTokens;
              multiplier = ev.multiplier;
            } else if (ev.t === "error") setPhase(cid, "error", { error: ev.d });
          }
        }

        // Finalize → persist the assistant turn (once). Flip to "finalizing"
        // first so the caret stops and the text settles while the writes land —
        // the swap to the persisted message is then visually a no-op.
        if (useStreamStore.getState().byConv[cid]?.phase === "streaming") {
          setPhase(cid, "finalizing");
        }
        const st = useStreamStore.getState().byConv[cid];
        const content = st?.content ?? "";
        // Thinking duration was captured at the reasoning→answer flip in the
        // store (first reasoning token → first answer token), not the full run.
        const reasoningMs =
          st?.reasoningMs ??
          (st?.reasoningFirstAt ? Date.now() - st.reasoningFirstAt : undefined);
        const erroredEmpty = st?.phase === "error" && !content;

        if (erroredEmpty) {
          clearController(cid);
          return; // keep the transient error visible; user msg remains for retry
        }

        // Ensure the conversation + user message landed before the assistant
        // turn (persistence runs concurrently with the stream — Part F).
        await args.persistence;
        const aId = await addMessage(uid, cid, {
          role: "assistant",
          content,
          reasoning: st?.reasoning || undefined,
          reasoningMs,
          parentId,
          model: settings.model,
          effort: settings.effort,
          thinking: settings.thinking,
          tokens,
          realTokensUsed: realTokens,
          forgeTokensDeducted: forgeTokens,
          multiplierUsed: multiplier,
          skillsUsed: st?.activeSkills?.length ? st.activeSkills : undefined,
          agentUsed: st?.activeAgent,
          searches: donePersistedSearches(st?.searches),
          attachments: doneAssistantAttachments(st),
          error: st?.phase === "error" || undefined,
        });
        await updateConversation(uid, cid, {
          activeLeafId: aId,
        });
        clear(cid);
        clearController(cid);
        void useUsageStore.getState().refresh(); // reflect the new token spend
      } catch (err: unknown) {
        const aborted = err instanceof Error && err.name === "AbortError";
        const st = useStreamStore.getState().byConv[cid];
        if (aborted && st && st.content) {
          // Persist the partial answer so it stays editable / regenerable.
          await args.persistence;
          const aId = await addMessage(uid, cid, {
            role: "assistant",
            content: st.content,
            reasoning: st.reasoning || undefined,
            reasoningMs:
              st.reasoningMs ??
              (st.reasoningFirstAt ? Date.now() - st.reasoningFirstAt : undefined),
            parentId,
            model: settings.model,
            effort: settings.effort,
            thinking: settings.thinking,
            skillsUsed: st.activeSkills?.length ? st.activeSkills : undefined,
            agentUsed: st.activeAgent,
            searches: donePersistedSearches(st.searches),
            attachments: doneAssistantAttachments(st),
          });
          await updateConversation(uid, cid, { activeLeafId: aId }).catch(() => {});
          clear(cid);
        } else if (!aborted) {
          setPhase(cid, "error", { error: "Forge couldn't respond. Please try again." });
        } else {
          clear(cid);
        }
        clearController(cid);
      }
    },
    [
      start,
      appendContent,
      appendReasoning,
      setPhase,
      upsertSearch,
      upsertGeneratedImage,
      clear,
    ]
  );

  const typeSuggestionAsk = useCallback(
    async (cid: string, args: RunArgs, skills: SuggestedSkill[]) => {
      const text = buildSkillSuggestionPrompt(skills);
      for (let i = 0; i < text.length; i += 3) {
        if (pendingRuns.get(cid)?.args !== args) return false;
        appendContent(cid, text.slice(i, i + 3));
        await sleep(14);
      }
      return pendingRuns.get(cid)?.args === args;
    },
    [appendContent]
  );

  const send = useCallback(
    async (params: {
      conversationId: string | null;
      activePath: ThreadNode[];
      text: string;
      attachments: OutgoingAttachments;
      titleIsDefault: boolean;
      parentLeafId: string | null;
      conversationTitle?: string | null;
    }) => {
      if (!user) {
        toast.error("Please sign in to chat.");
        return;
      }
      const { model, effort, thinking, toolsEnabled, activeSkillSlugs, activeAgentId, incognito } =
        useComposerStore.getState();
      const settings = { model, effort, thinking };

      // Auto-enable a creator skill when the user clearly wants to make/edit a
      // skill or agent — this path is automatic, never a suggestion prompt.
      const intent = detectCreatorIntent(params.text);
      let effectiveSlugs = activeSkillSlugs;
      if (intent) {
        const slug = intent === "agent" ? AGENT_CREATOR_SLUG : SKILL_CREATOR_SLUG;
        const available = allSkills.some((s) => s.slug === slug && s.enabled);
        if (available && !effectiveSlugs.includes(slug)) {
          effectiveSlugs = [...effectiveSlugs, slug];
          useComposerStore.getState().addSkill(slug); // surface the chip
        }
      }

      // Part F — don't block the model request on persistence. Generate ids
      // locally, kick the writes off in the background (they update the cache
      // optimistically), and let runStream start the /api/chat fetch right away.
      const isNew = !params.conversationId;
      const cid = params.conversationId ?? genId("conv");
      const userMsgId = genId("msg");

      // Image + document chips for the persisted user message + optimistic bubble.
      const persistedAttachments: MessageAttachment[] = [
        ...params.attachments.images,
        ...params.attachments.documents.map((d) => ({ type: "document" as const, name: d.name })),
        ...params.attachments.scannedPdfs.map((s) => ({
          type: "document" as const,
          name: s.name,
          analyzed: true,
        })),
      ];

      const persistence = (async () => {
        if (isNew) {
          await createConversation(user.uid, { id: cid, title: "New chat", model, effort, thinking });
        } else {
          await updateConversation(user.uid, cid, { model, effort, thinking });
        }
        await addMessage(user.uid, cid, {
          id: userMsgId,
          role: "user",
          content: params.text,
          parentId: params.parentLeafId,
          model,
          effort,
          thinking,
          attachments: persistedAttachments.length ? persistedAttachments : undefined,
        });
        await updateConversation(user.uid, cid, {
          activeLeafId: userMsgId,
          model,
          effort,
          thinking,
        });
      })().catch(() => {});

      // A new send supersedes any pending skill suggestion in this conversation.
      useSuggestionStore.getState().clear(cid);
      pendingRuns.delete(cid);

      const isFirstUserMessage = !params.activePath.some((node) => node.role === "user");
      if (params.titleIsDefault && isFirstUserMessage) {
        const titleCid = cid;
        void (async () => {
          const title = await fetchConversationTitle(getIdToken, params.text);
          if (title && title !== "New chat") {
            await updateConversation(user.uid, titleCid, { title }).catch(() => {});
          }
        })();
      }

      if (isNew) router.push(`/c/${cid}`);

      // Mark active skills as recently used (for picker ordering).
      effectiveSlugs.forEach((slug) => touchSkillUsed(user.uid, slug).catch(() => {}));

      const wire = [
        ...toWire(params.activePath),
        { role: "user" as const, content: params.text },
      ];
      const args: RunArgs = {
        uid: user.uid,
        cid,
        parentId: userMsgId,
        parentLeafId: params.parentLeafId,
        userMessageContent: params.text,
        wire,
        settings,
        toolsEnabled,
        skillSlugs: effectiveSlugs,
        skills: resolveSkills(effectiveSlugs, allSkills),
        skillCatalog: buildSkillCatalog(allSkills),
        skillMeta: resolveSkillMeta(effectiveSlugs, allSkills),
        agentId: activeAgentId,
        agentMeta: resolveAgentMeta(activeAgentId, agents),
        incognito,
        conversationTitle: params.conversationTitle,
        titleIsDefault: params.titleIsDefault,
        attachments: params.attachments,
        persistedAttachments: persistedAttachments.length ? persistedAttachments : undefined,
        persistence,
        getIdToken,
      };

      // Skill suggestion pre-pass — only when no creator intent fired and there
      // are eligible, not-yet-declined skills that could clearly help this turn.
      const candidates: SkillCatalogEntry[] = intent || params.text.trim().length < 12
        ? []
        : buildSkillCatalog(allSkills).filter(
            (c) =>
              !effectiveSlugs.includes(c.slug) &&
              c.slug !== SKILL_CREATOR_SLUG &&
              c.slug !== AGENT_CREATOR_SLUG &&
              allSkills.some((s) => s.slug === c.slug && s.enabled) &&
              !useSuggestionStore.getState().hasDeclined(cid, c.slug)
          );

      if (candidates.length > 0) {
        pendingRuns.set(cid, { args });
        start({
          conversationId: cid,
          userMessageId: userMsgId,
          userMessageContent: params.text,
          userMessageAttachments: args.persistedAttachments,
          userMessageParentId: params.parentLeafId,
          content: "",
          reasoning: "",
          phase: "streaming",
          reasoningStart: Date.now(),
          model: settings.model,
          effort: settings.effort,
          thinking: settings.thinking,
          activeSkills: args.skillMeta,
          activeAgent: args.agentMeta ?? undefined,
        });
        useSuggestionStore.getState().setChecking(cid);
        const suggestions = (await fetchSuggestion(getIdToken, params.text, candidates)).filter(
          (skill) => !useSuggestionStore.getState().hasDeclined(cid, skill.slug)
        );
        // Bail if a newer send superseded this one while we waited.
        if (pendingRuns.get(cid)?.args !== args) return;
        if (suggestions.length > 0) {
          pendingRuns.set(cid, {
            args,
            suggestedSlugs: suggestions.map((skill) => skill.slug),
          });
          const typed = await typeSuggestionAsk(cid, args, suggestions);
          if (!typed) return;
          useSuggestionStore.getState().setAsk(cid, suggestions);
          return; // wait for the user's choice before generating
        }
        pendingRuns.delete(cid);
        useSuggestionStore.getState().clear(cid);
        await runStream(args, { reuseExisting: true });
        return;
      }

      await runStream(args);
    },
    [user, getIdToken, router, runStream, typeSuggestionAsk, start, allSkills, agents]
  );

  /** Resolve a pending skill suggestion: generate with or without the skill. */
  const resolveSuggestion = useCallback(
    async (cid: string, accept: boolean) => {
      const pending = pendingRuns.get(cid);
      pendingRuns.delete(cid);
      useSuggestionStore.getState().clear(cid);
      if (!pending) return;
      clear(cid);
      const { args, suggestedSlugs = [] } = pending;
      if (accept && suggestedSlugs.length > 0) {
        suggestedSlugs.forEach((slug) => {
          useComposerStore.getState().addSkill(slug); // show the chips
          touchSkillUsed(args.uid, slug).catch(() => {});
        });
        const finalSlugs = Array.from(new Set([...args.skillSlugs, ...suggestedSlugs]));
        await runStream({
          ...args,
          skillSlugs: finalSlugs,
          skills: resolveSkills(finalSlugs, allSkills),
          skillMeta: resolveSkillMeta(finalSlugs, allSkills),
        });
      } else {
        suggestedSlugs.forEach((slug) => useSuggestionStore.getState().decline(cid, slug));
        await runStream(args);
      }
    },
    [runStream, clear, allSkills]
  );

  const regenerate = useCallback(
    async (params: { conversationId: string; activePath: ThreadNode[]; assistantId: string }) => {
      if (!user) return;
      const { activePath, assistantId, conversationId } = params;
      const idx = activePath.findIndex((m) => m.id === assistantId);
      if (idx < 1) return;
      const prefix = activePath.slice(0, idx); // ends at the parent user message
      const parent = prefix[prefix.length - 1];
      if (!parent || parent.role !== "user") return;

      const { model, effort, thinking, toolsEnabled, activeSkillSlugs, activeAgentId, incognito } =
        useComposerStore.getState();
      await runStream({
        uid: user.uid,
        cid: conversationId,
        parentId: parent.id,
        parentLeafId: parent.parentId,
        userMessageContent: parent.content,
        wire: toWire(prefix),
        settings: { model, effort, thinking },
        toolsEnabled,
        skillSlugs: activeSkillSlugs,
        skills: resolveSkills(activeSkillSlugs, allSkills),
        skillCatalog: buildSkillCatalog(allSkills),
        skillMeta: resolveSkillMeta(activeSkillSlugs, allSkills),
        agentId: activeAgentId,
        agentMeta: resolveAgentMeta(activeAgentId, agents),
        incognito,
        conversationTitle: undefined,
        titleIsDefault: false,
        // Re-send the original images for vision; document text isn't persisted.
        attachments: {
          images: getImageAttachments(parent.attachments),
          documents: [],
          scannedPdfs: [],
        },
        persistedAttachments: parent.attachments
          ? (Array.isArray(parent.attachments) ? parent.attachments : [parent.attachments])
          : undefined,
        getIdToken,
      });
    },
    [user, getIdToken, runStream, allSkills, agents]
  );

  const stop = useCallback((cid: string) => abortController(cid), []);

  return { send, stop, regenerate, resolveSuggestion };
}

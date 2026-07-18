"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useMessages } from "@/hooks/use-messages";
import { useConversation } from "@/hooks/use-conversation";
import { useChatController } from "@/hooks/use-chat-send";
import { useStreamStore } from "@/lib/store/stream-store";
import { useComposerStore } from "@/lib/store/composer-store";
import { useUIStore } from "@/lib/store/ui-store";
import { buildActivePath, leafOf, siblingsOf, type ThreadNode } from "@/lib/data/tree";
import { updateConversation } from "@/lib/data/chat";
import { Message } from "./message";
import { StreamingMessage } from "./streaming-message";
import { SkillSuggestionCard } from "./skill-suggestion-card";
import { useSuggestionStore } from "@/lib/store/suggestion-store";
import { Composer } from "./composer";
import { ArtifactPanel } from "./artifact-panel";
import { useArtifactStore } from "@/lib/store/artifact-store";
import { SparkFilled } from "@/components/icons";
import { getImageAttachments } from "@/lib/data/attachments";
import type { OutgoingAttachments } from "@/lib/data/types";

const SUGGESTIONS = [
  "Draft a project plan for a new app idea",
  "Explain a tricky concept simply",
  "Write a Python script and walk me through it",
  "Help me outline a blog post",
];

export function ChatView({ conversationId }: { conversationId: string | null }) {
  const { user, profile, getIdToken } = useAuth();
  const { messages, loading } = useMessages(conversationId);
  const conversation = useConversation(conversationId);
  const { send, stop, regenerate, resolveSuggestion } = useChatController();
  const streaming = useStreamStore((s) =>
    conversationId ? s.byConv[conversationId] : undefined
  );
  const suggestion = useSuggestionStore((s) =>
    conversationId ? s.byConv[conversationId] : undefined
  );
  const syncFromConversation = useComposerStore((s) => s.syncFromConversation);
  const hydrateDefaults = useComposerStore((s) => s.hydrateDefaults);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const artifact = useArtifactStore((s) => s.artifact);

  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const hydratedFor = useRef<string | null | undefined>(undefined);

  // Family 44 — "Spring & refocus": the optimistically appended user message
  // gets a transient .just-sent launch beat (~500ms). Regenerate reuses an
  // already-visible user message, so only a genuinely new optimistic append
  // (id not yet in the persisted path) triggers it.
  const [justSentId, setJustSentId] = useState<string | null>(null);
  const lastLaunchId = useRef<string | null>(streaming?.userMessageId ?? null);

  // Family 45 — "Rise to focus": scroll-to-latest pill. A 1px sentinel sits at
  // the live bottom of the thread; the pill shows once it drifts ≥400px out of
  // view and smooth-scrolls back down on click. No other behavior.
  const bottomRef = useRef<HTMLDivElement>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  // Streaming→persisted handoff: when the stream clears, the persisted user +
  // assistant turn take its place in the SAME render. Remember which turn that
  // is so those messages mount without the entrance animation — the content is
  // already on screen and must not "re-appear".
  const handoffUserMsgId = useRef<string | null>(null);
  if (streaming) handoffUserMsgId.current = streaming.userMessageId;

  const activePath = useMemo(
    () => buildActivePath(messages, conversation?.activeLeafId),
    [messages, conversation?.activeLeafId]
  );

  // Sync composer settings to the active context.
  useEffect(() => {
    if (conversationId && conversation) {
      if (hydratedFor.current !== conversation.id) {
        syncFromConversation({
          model: conversation.model,
          effort: conversation.effort,
          thinking: conversation.thinking,
        });
        hydratedFor.current = conversation.id;
      }
    } else if (!conversationId && profile) {
      if (hydratedFor.current !== "new") {
        hydrateDefaults({
          model: profile.defaultModel,
          effort: profile.defaultEffort,
          thinking: profile.defaultThinking,
          toolsEnabled: profile.defaultToolsEnabled,
        });
        hydratedFor.current = "new";
      }
    }
  }, [conversationId, conversation, profile, syncFromConversation, hydrateDefaults]);

  // Close the artifact preview when switching or leaving conversations.
  useEffect(() => {
    return () => useArtifactStore.getState().close();
  }, [conversationId]);

  // Session-boundary memory distillation (§12): when leaving a conversation the
  // user added to, distill durable facts into their memory profile (server-side).
  const distillBaseline = useRef<{ cid: string | null; count: number }>({ cid: null, count: -1 });
  const distillLive = useRef(0);
  useEffect(() => {
    distillBaseline.current = { cid: conversationId, count: -1 };
  }, [conversationId]);
  useEffect(() => {
    distillLive.current = messages.length;
    if (distillBaseline.current.cid === conversationId && distillBaseline.current.count < 0) {
      distillBaseline.current.count = messages.length;
    }
  }, [messages.length, conversationId]);
  useEffect(() => {
    const cid = conversationId;
    const memOn = profile?.memoryEnabled;
    return () => {
      const base = distillBaseline.current.count;
      if (!cid || !memOn || base < 0 || distillLive.current <= base || distillLive.current < 4) return;
      getIdToken().then((token) => {
        if (!token) return;
        fetch("/api/memory", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ conversationId: cid }),
          keepalive: true,
        }).catch(() => {});
      });
    };
  }, [conversationId, profile?.memoryEnabled, getIdToken]);

  // Stick-to-bottom autoscroll.
  const contentLen = streaming
    ? streaming.content.length + streaming.reasoning.length
    : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [activePath.length, contentLen, streaming?.phase, suggestion?.phase]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Family 44 trigger — fires once per new optimistic user message.
  useEffect(() => {
    const id = streaming?.userMessageId ?? null;
    if (!id || id === lastLaunchId.current) return;
    lastLaunchId.current = id;
    if (activePath.some((n) => n.id === id)) return; // regenerate: already on screen
    setJustSentId(id);
  }, [streaming?.userMessageId, activePath]);
  useEffect(() => {
    if (!justSentId) return;
    const t = setTimeout(() => setJustSentId(null), 600);
    return () => clearTimeout(t);
  }, [justSentId]);

  // Family 45 — the pill appears when the bottom sentinel is ≥400px out of view.
  useEffect(() => {
    const root = scrollRef.current;
    const target = bottomRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      ([entry]) => setAwayFromLatest(!entry.isIntersecting),
      { root, rootMargin: "0px 0px 400px 0px" }
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  const userInitial = (
    profile?.displayName?.[0] ||
    user?.displayName?.[0] ||
    user?.email?.[0] ||
    "U"
  ).toUpperCase();

  const displayPath = useMemo(() => {
    if (!streaming) return activePath;
    const idx = activePath.findIndex((n) => n.id === streaming.userMessageId);
    if (idx >= 0) return activePath.slice(0, idx + 1);
    if (!streaming.userMessageContent && !streaming.userMessageAttachments) return activePath;
    const optimisticUser: ThreadNode = {
      id: streaming.userMessageId,
      role: "user",
      content: streaming.userMessageContent ?? "",
      attachments: streaming.userMessageAttachments,
      parentId: streaming.userMessageParentId,
      createdAt: streaming.reasoningStart,
      model: streaming.model,
      effort: streaming.effort,
      thinking: streaming.thinking,
      siblings: 1,
      siblingIndex: 0,
    };
    return [...activePath, optimisticUser];
  }, [activePath, streaming]);

  const titleIsDefault =
    !conversation || !conversation.title || conversation.title === "New chat";

  const handleSend = (text: string, attachments: OutgoingAttachments) => {
    stickRef.current = true;
    send({
      conversationId,
      activePath,
      text,
      attachments,
      titleIsDefault,
      parentLeafId: activePath.length ? activePath[activePath.length - 1].id : null,
      conversationTitle: conversation?.title ?? null,
    });
  };

  const handleRegenerate = (node: ThreadNode) => {
    if (!conversationId) return;
    stickRef.current = true;
    regenerate({ conversationId, activePath, assistantId: node.id });
  };

  const handleEdit = (node: ThreadNode, newText: string) => {
    if (!conversationId) return;
    const idx = activePath.findIndex((n) => n.id === node.id);
    const prefix = idx >= 0 ? activePath.slice(0, idx) : activePath;
    stickRef.current = true;
    send({
      conversationId,
      activePath: prefix,
      text: newText,
      attachments: { images: getImageAttachments(node.attachments), documents: [], scannedPdfs: [] },
      titleIsDefault: false,
      parentLeafId: node.parentId,
      conversationTitle: conversation?.title ?? null,
    });
  };

  const handleBranch = async (node: ThreadNode, dir: -1 | 1) => {
    if (!user || !conversationId) return;
    const sibs = siblingsOf(messages, node.parentId ?? null);
    const target = sibs[node.siblingIndex + dir];
    if (!target) return;
    const leaf = leafOf(messages, target.id);
    await updateConversation(user.uid, conversationId, { activeLeafId: leaf });
  };

  const isStreaming = Boolean(streaming && streaming.phase !== "error");
  const showEmpty = !conversationId && activePath.length === 0 && !streaming;
  const showSkeleton = Boolean(conversationId) && loading && activePath.length === 0;

  return (
    <>
    <div className="chat-col">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {showEmpty ? (
          <div className="empty-state">
            <div className="es-glyph">
              <SparkFilled style={{ width: 30, height: 30 }} />
            </div>
            <h2>What can I help you build?</h2>
            <p>
              Ask anything, create documents, analyze files, or start a coding
              project. Forge keeps your work in one place.
            </p>
            <div className="empty-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="suggestion"
                  onClick={() => setSeed({ text: s, n: Date.now() })}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : showSkeleton ? (
          <div className="thread">
            {[0, 1, 2].map((i) => (
              <div className="msg" key={i}>
                <div className="skeleton" style={{ width: 30, height: 30, borderRadius: 8 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: 80, height: 12, marginBottom: 10 }} />
                  <div className="skeleton" style={{ width: "90%", height: 14, marginBottom: 7 }} />
                  <div className="skeleton" style={{ width: "70%", height: 14 }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="thread">
            {displayPath.map((node) => (
              <Message
                key={node.id}
                node={node}
                userInitial={userInitial}
                onRegenerate={handleRegenerate}
                onEdit={handleEdit}
                onBranch={handleBranch}
                noEntrance={
                  node.role === "assistant" && node.parentId === handoffUserMsgId.current
                }
                justSent={node.id === justSentId}
              />
            ))}
            {streaming && (
              <StreamingMessage
                state={streaming}
                skillSuggestion={suggestion?.phase === "ask" ? suggestion : undefined}
                onUseSuggestion={
                  conversationId && suggestion?.phase === "ask"
                    ? () => resolveSuggestion(conversationId, true)
                    : undefined
                }
                onDeclineSuggestion={
                  conversationId && suggestion?.phase === "ask"
                    ? () => resolveSuggestion(conversationId, false)
                    : undefined
                }
                onRetry={
                  streaming.phase === "error"
                    ? () => {
                        const last = activePath[activePath.length - 1];
                        if (last?.role === "assistant") handleRegenerate(last);
                      }
                    : undefined
                }
              />
            )}
            {!streaming && suggestion && conversationId && (
              <SkillSuggestionCard
                suggestion={suggestion}
                onUse={() => resolveSuggestion(conversationId, true)}
                onDecline={() => resolveSuggestion(conversationId, false)}
              />
            )}
          </div>
        )}
        <div ref={bottomRef} aria-hidden style={{ height: 1 }} />
      </div>

      {awayFromLatest && (
        <button
          type="button"
          className="scroll-latest"
          aria-label="Scroll to latest messages"
          onClick={() => {
            const el = scrollRef.current;
            if (!el) return;
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
          }}
        >
          <ChevronDown size={14} />
        </button>
      )}

      <Composer
        onSend={handleSend}
        streaming={isStreaming}
        onStop={() => conversationId && stop(conversationId)}
        autoFocus
        seed={seed}
      />
    </div>

    {/* Right panel — Claude-style artifact preview (slides in, sidebar collapses). */}
    <aside
      className={`right-panel ${rightPanelOpen ? "open" : ""}`}
      aria-hidden={!rightPanelOpen}
    >
      {artifact && <ArtifactPanel />}
    </aside>
    </>
  );
}

"use client";

import { useState } from "react";
import {
  Copy,
  Check,
  Volume2,
  Square,
  RefreshCw,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  ChevronLeft,
  ChevronRight,
  FileText,
} from "lucide-react";
import { SparkFilled } from "@/components/icons";
import { Markdown } from "./markdown";
import { ThinkingPanel } from "./thinking-panel";
import { SkillStatus } from "./skill-status";
import { SearchStatus } from "./search-status";
import type { ThreadNode } from "@/lib/data/tree";
import { toast } from "@/lib/store/toast-store";
import {
  getGeneratedImageAttachments,
  getImageAttachments,
  getDocumentAttachments,
  imageAttachmentToDataUrl,
} from "@/lib/data/attachments";
import { GeneratedImageCard } from "./generated-image-card";
import { useTts } from "@/hooks/use-tts";
import { usePlan } from "@/lib/plans/use-plan";
import { getFeatureLimit, getUpgradeMessage, getRequiredPlan } from "@/lib/plans/gates";
import { useUsageStore } from "@/lib/store/usage-store";

interface MessageProps {
  node: ThreadNode;
  userInitial: string;
  onRegenerate?: (node: ThreadNode) => void;
  onEdit?: (node: ThreadNode, newText: string) => void;
  onBranch?: (node: ThreadNode, dir: -1 | 1) => void;
  /** True when this message replaces a live stream in place — the content is
   *  already on screen, so the entrance animation must not replay. */
  noEntrance?: boolean;
}

export function Message({ node, userInitial, onRegenerate, onEdit, onBranch, noEntrance }: MessageProps) {
  const isUser = node.role === "user";
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.content);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const imageAttachments = getImageAttachments(node.attachments);
  const documentAttachments = getDocumentAttachments(node.attachments);
  const generatedImages = getGeneratedImageAttachments(node.attachments);
  const tts = useTts(node.content);
  const ttsActive = tts.status !== "idle";
  const plan = usePlan();
  const voiceOutputLocked = getFeatureLimit(plan, "voice_output_chars") === 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.content);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  const submitEdit = () => {
    const text = draft.trim();
    if (text && text !== node.content) onEdit?.(node, text);
    setEditing(false);
  };

  return (
    <div className={`msg ${isUser ? "user" : "ai"}${noEntrance ? " msg-static" : ""}`}>
      <div className="msg-avatar">
        {isUser ? (
          userInitial
        ) : node.agentUsed ? (
          <span className="agent-avatar-glyph">{node.agentUsed.avatar || "🤖"}</span>
        ) : (
          <SparkFilled style={{ width: 16, height: 16 }} />
        )}
      </div>
      <div className="msg-body">
        <div className="msg-name">
          {isUser ? (
            "You"
          ) : node.agentUsed ? (
            <>
              {node.agentUsed.name}
              <span className="agent-name-tag">Agent</span>
            </>
          ) : (
            "Forge OS"
          )}
        </div>

        {!isUser && <SkillStatus skills={node.skillsUsed} />}

        {!isUser && node.searches && node.searches.length > 0 && (
          <SearchStatus
            searches={node.searches.map((s, i) => ({
              id: `${node.id}-${i}`,
              query: s.query,
              done: true,
              count: s.count,
              sources: s.sources,
            }))}
          />
        )}

        {!isUser && node.reasoning && (
          <ThinkingPanel
            reasoning={node.reasoning}
            active={false}
            durationMs={node.reasoningMs}
          />
        )}

        {editing ? (
          <div className="composer" style={{ boxShadow: "none", padding: 12 }}>
            <textarea
              className="composer-input"
              value={draft}
              autoFocus
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(node.content);
                }
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn-ghost" onClick={() => { setEditing(false); setDraft(node.content); }}>
                Cancel
              </button>
              <button className="btn-amber" onClick={submitEdit}>
                Save &amp; submit
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="msg-user-content">
            {node.content && (
              <div className="msg-text" style={{ whiteSpace: "pre-wrap" }}>
                {node.content}
              </div>
            )}
            {(imageAttachments.length > 0 || documentAttachments.length > 0) && (
              <div className="msg-attachments">
                {imageAttachments.map((img, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`img-${i}`}
                    className="msg-image-thumb"
                    src={imageAttachmentToDataUrl(img)}
                    alt="Attached image"
                  />
                ))}
                {documentAttachments.map((doc, i) => (
                  <span className="msg-doc-chip" key={`doc-${i}`} title={doc.name}>
                    <FileText size={14} />
                    <span className="msg-doc-name">{doc.name}</span>
                    {doc.analyzed && <span className="msg-doc-tag">AI-read</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : node.error ? (
          <div className="msg-text" style={{ color: "var(--danger)" }}>
            {node.content || "Forge couldn't complete this response."}
          </div>
        ) : (
          <>
            {generatedImages.map((image) => (
              <GeneratedImageCard
                key={`${image.imageUrl}-${image.prompt}`}
                imageUrl={image.imageUrl}
                prompt={image.prompt}
                notice={image.notice}
              />
            ))}
            {node.content && (
              <div className="msg-text">
                <Markdown content={node.content} />
              </div>
            )}
          </>
        )}

        {node.siblings > 1 && (
          <div className="branch-switch">
            <button
              onClick={() => onBranch?.(node, -1)}
              disabled={node.siblingIndex === 0}
              aria-label="Previous branch"
            >
              <ChevronLeft size={13} />
            </button>
            <span key={node.siblingIndex} className="swap-in">
              {node.siblingIndex + 1}/{node.siblings}
            </span>
            <button
              onClick={() => onBranch?.(node, 1)}
              disabled={node.siblingIndex === node.siblings - 1}
              aria-label="Next branch"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}

        {!editing && (
          <div className={`msg-actions ${ttsActive ? "tts-active" : ""}`}>
            <button className="msg-action" onClick={copy} title="Copy">
              {copied ? (
                <span className="copy-pop">
                  <Check size={14} />
                </span>
              ) : (
                <Copy size={14} />
              )}
            </button>
            {isUser ? (
              <button className="msg-action" onClick={() => setEditing(true)} title="Edit">
                <Pencil size={14} />
              </button>
            ) : (
              <>
                {!node.error && node.content.trim().length > 0 && (
                  <button
                    className={`msg-action tts-action ${tts.status === "playing" ? "playing" : ""}`}
                    onClick={() => {
                      if (voiceOutputLocked) {
                        useUsageStore.getState().openGate({
                          feature: "voice_output",
                          message: getUpgradeMessage(plan, "Voice output"),
                          requiredPlan: getRequiredPlan("Voice output"),
                        });
                        return;
                      }
                      tts.toggle();
                    }}
                    title={
                      voiceOutputLocked
                        ? getUpgradeMessage(plan, "Voice output")
                        : tts.status === "playing"
                          ? "Stop"
                          : "Read aloud"
                    }
                    aria-label={tts.status === "playing" ? "Stop reading" : "Read aloud"}
                  >
                    {tts.status === "loading" ? (
                      <span className="tts-spinner" aria-hidden />
                    ) : tts.status === "playing" ? (
                      <Square size={13} fill="currentColor" />
                    ) : (
                      <Volume2 size={14} />
                    )}
                  </button>
                )}
                <button
                  className="msg-action"
                  onClick={() => onRegenerate?.(node)}
                  title="Regenerate"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  className={`msg-action ${vote === "up" ? "on" : ""}`}
                  onClick={() => setVote(vote === "up" ? null : "up")}
                  title="Good response"
                >
                  <ThumbsUp size={14} />
                </button>
                <button
                  className={`msg-action ${vote === "down" ? "on" : ""}`}
                  onClick={() => setVote(vote === "down" ? null : "down")}
                  title="Bad response"
                >
                  <ThumbsDown size={14} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

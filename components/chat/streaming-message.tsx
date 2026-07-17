"use client";

import { RefreshCw } from "lucide-react";
import { SparkFilled } from "@/components/icons";
import { Markdown } from "./markdown";
import { ThinkingPanel } from "./thinking-panel";
import { SkillStatus } from "./skill-status";
import { SearchStatus } from "./search-status";
import { TypingDots } from "./typing-dots";
import { ArtifactStreaming } from "./markdown-context";
import { SkillSuggestionActions } from "./skill-suggestion-card";
import { GeneratedImage } from "./generated-image-card";
import { AnalyzingImage } from "./analyzing-image";
import { getImageAttachments } from "@/lib/data/attachments";
import type { StreamingState } from "@/lib/store/stream-store";
import type { PendingSuggestion } from "@/lib/store/suggestion-store";

export function StreamingMessage({
  state,
  onRetry,
  skillSuggestion,
  onUseSuggestion,
  onDeclineSuggestion,
}: {
  state: StreamingState;
  onRetry?: () => void;
  skillSuggestion?: PendingSuggestion;
  onUseSuggestion?: () => void;
  onDeclineSuggestion?: () => void;
}) {
  const reasoningActive = state.phase === "reasoning";
  const hasContent = state.content.length > 0;
  const isError = state.phase === "error";
  const showSuggestionActions = skillSuggestion?.phase === "ask";
  // The caret means "more text is coming" — hide it once the stream is done
  // and the message is just being persisted (otherwise it blinks, then the
  // persisted message appears caret-less: a visible pop).
  const showCaret = !showSuggestionActions && state.phase !== "finalizing";
  const hasImageGeneration = (state.generatedImages?.length ?? 0) > 0;
  const hasPendingImage = Boolean(state.generatedImages?.some((image) => !image.done));
  const showGenerating =
    !isError &&
    !hasContent &&
    !reasoningActive &&
    !showSuggestionActions &&
    !hasImageGeneration;
  const analyzingImage = getImageAttachments(state.userMessageAttachments).length > 0;

  return (
    <div className={`msg ai${isError ? "" : " streaming"}`}>
      <div className="msg-avatar">
        {state.activeAgent ? (
          <span className="agent-avatar-glyph">{state.activeAgent.avatar || "AI"}</span>
        ) : (
          <SparkFilled style={{ width: 16, height: 16 }} />
        )}
      </div>
      <div className="msg-body">
        <div className="msg-name">
          {state.activeAgent ? (
            <>
              {state.activeAgent.name}
              <span className="agent-name-tag">Agent</span>
            </>
          ) : (
            "Forge OS"
          )}
        </div>

        {!showGenerating && !hasPendingImage && <SkillStatus skills={state.activeSkills} working />}

        {!showGenerating && !hasPendingImage && <SearchStatus searches={state.searches} live />}

        {state.thinking && (reasoningActive || state.reasoning) && (
          <ThinkingPanel
            reasoning={state.reasoning}
            active={reasoningActive}
            durationMs={state.reasoningMs}
          />
        )}

        {state.generatedImages?.map((image) => (
          <GeneratedImage
            key={image.id}
            done={image.done}
            loadingText={image.loadingText}
            imageUrl={image.imageUrl}
            prompt={image.prompt}
            error={image.error}
            notice={image.notice}
          />
        ))}

        {isError ? (
          <div>
            <div className="msg-text shake" style={{ color: "var(--danger)" }}>
              {state.error}
            </div>
            {onRetry && (
              <button className="btn-ghost" style={{ marginTop: 10 }} onClick={onRetry}>
                <RefreshCw size={14} /> Retry
              </button>
            )}
          </div>
        ) : hasContent ? (
          <div className="msg-text">
            <ArtifactStreaming.Provider value={true}>
              <Markdown content={state.content} />
            </ArtifactStreaming.Provider>
            {showCaret && <span className="streaming-caret" aria-hidden />}
          </div>
        ) : showGenerating ? (
          analyzingImage ? (
            <AnalyzingImage />
          ) : (
            <div className="status-chip" aria-live="polite" aria-label="Generating">
              <TypingDots />
            </div>
          )
        ) : null}

        {showSuggestionActions && skillSuggestion && onUseSuggestion && onDeclineSuggestion && (
          <SkillSuggestionActions
            suggestion={skillSuggestion}
            onUse={onUseSuggestion}
            onDecline={onDeclineSuggestion}
          />
        )}
      </div>
    </div>
  );
}

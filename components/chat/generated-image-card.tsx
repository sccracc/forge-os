"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Lock } from "lucide-react";

function truncatePrompt(prompt: string): string {
  return prompt.length > 100 ? `${prompt.slice(0, 97)}...` : prompt;
}

async function downloadImage(imageUrl: string) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = "forge-image.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(imageUrl, "_blank", "noopener,noreferrer");
  }
}

export function GeneratedImageErrorCard({ message }: { message: string }) {
  // Feature-gate / limit errors get a subtle inline upgrade card (§STEP 4).
  if (/is available on|limit reached/i.test(message)) {
    return (
      <a className="inline-upgrade-card" href="/settings#billing">
        <Lock size={15} />
        <span className="iuc-msg">{message}</span>
        <span className="iuc-cta">Upgrade</span>
      </a>
    );
  }
  return <div className="generated-image-error">{message}</div>;
}

export interface GeneratedImageProps {
  done: boolean;
  loadingText?: string;
  imageUrl?: string;
  prompt?: string;
  error?: string;
  notice?: string;
  /** False on persisted mounts (incl. the streaming→persisted swap): the image
   *  is already on screen, so the shimmer + fade/scale reveal must not replay. */
  reveal?: boolean;
}

/**
 * Generated-image card — "shimmer skeleton" animation: a shimmer sweep fills the
 * square frame while generating, then the image fades + settles in over it. One
 * component for both phases so, kept keyed by id, the frame persists across the
 * loading→done flip for a seamless reveal. Used live (streaming) and persisted.
 */
export function GeneratedImage({ done, loadingText, imageUrl, prompt, error, notice, reveal = true }: GeneratedImageProps) {
  const [loaded, setLoaded] = useState(!reveal);

  if (done && error) return <GeneratedImageErrorCard message={error} />;

  return (
    <div className="generated-image-card">
      <div className="generated-image-frame">
        {(!done || !loaded) && (
          <>
            <motion.div
              aria-hidden
              className="generated-image-shimmer"
              animate={{ opacity: [0.45, 1, 0.45] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            />
            {/* Family 36 "Latent drift": two blurred latents wander the frame
                while generating (CSS transform loops on .latent-a/.latent-b). */}
            <span className="latent-a" aria-hidden />
            <span className="latent-b" aria-hidden />
          </>
        )}
        {!done && (
          <div className="generated-image-loading">
            <motion.span
              className="gi-emoji"
              animate={{ rotate: [0, 14, -14, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              🎨
            </motion.span>
            <span>{loadingText || "Generating your image..."}</span>
          </div>
        )}
        {done && imageUrl && (
          <motion.img
            src={imageUrl}
            alt={prompt || ""}
            // A cached image can finish before React attaches onLoad — without
            // the `complete` check the card would stay stuck on the shimmer.
            ref={(el) => {
              if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
            }}
            onLoad={() => setLoaded(true)}
            // Family 36 condense: the image resolves out of the latents —
            // blur+scale collapse on the demo's longer curve (f36c-img).
            initial={reveal ? { opacity: 0, scale: 1.06, filter: "blur(7px)" } : false}
            animate={loaded ? { opacity: 1, scale: 1, filter: "blur(0px)" } : { opacity: 0 }}
            transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
          />
        )}
      </div>
      {done && imageUrl && prompt && (
        <div className="generated-image-meta">
          <small title={prompt}>{truncatePrompt(prompt)}</small>
          <button
            className="generated-image-download"
            type="button"
            onClick={() => downloadImage(imageUrl)}
            title="Download image"
          >
            <Download size={14} />
          </button>
        </div>
      )}
      {done && imageUrl && notice && (
        <p className="generated-image-notice" role="note">
          {notice}
        </p>
      )}
    </div>
  );
}

/** Convenience wrapper for a finished image (persisted messages) — static, no reveal replay. */
export function GeneratedImageCard({
  imageUrl,
  prompt,
  notice,
}: {
  imageUrl: string;
  prompt: string;
  notice?: string;
}) {
  return (
    <GeneratedImage done loadingText="" imageUrl={imageUrl} prompt={prompt} notice={notice} reveal={false} />
  );
}

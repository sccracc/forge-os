"use client";

import { useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/lib/supabase/client";
import { toast } from "@/lib/store/toast-store";

export type TtsStatus = "idle" | "loading" | "playing";

interface TtsSelf {
  audio: HTMLAudioElement | null;
  url: string | null;
  controller: AbortController | null;
  stop: () => void;
}

// Only one message may play at a time. When a new player starts it stops the
// previous one. Module-level so it is shared across all message instances.
let activePlayer: TtsSelf | null = null;

/**
 * Text-to-speech playback for a single AI message. Fetches MP3 audio from
 * /api/voice/speak, plays it, and exposes a `toggle` (start ⇄ stop). Starting
 * playback automatically stops whatever else was playing.
 */
export function useTts(text: string) {
  const [status, setStatus] = useState<TtsStatus>("idle");

  // Latest text without forcing the play() closure to be recreated.
  const textRef = useRef(text);
  textRef.current = text;

  // Stable per-instance container so module-level identity checks work.
  const ref = useRef<TtsSelf | null>(null);
  if (!ref.current) {
    const self: TtsSelf = { audio: null, url: null, controller: null, stop: () => {} };
    self.stop = () => {
      self.controller?.abort();
      self.controller = null;
      if (self.audio) {
        self.audio.onended = null;
        self.audio.onerror = null;
        self.audio.pause();
        try {
          self.audio.currentTime = 0;
        } catch {
          /* ignore */
        }
        self.audio = null;
      }
      if (self.url) {
        URL.revokeObjectURL(self.url);
        self.url = null;
      }
      if (activePlayer === self) activePlayer = null;
      setStatus("idle");
    };
    ref.current = self;
  }
  const self = ref.current;

  const finish = () => {
    if (self.url) {
      URL.revokeObjectURL(self.url);
      self.url = null;
    }
    self.audio = null;
    self.controller = null;
    if (activePlayer === self) activePlayer = null;
    setStatus("idle");
  };

  const play = async () => {
    // Stop any other message that is loading/playing.
    if (activePlayer && activePlayer !== self) activePlayer.stop();
    activePlayer = self;
    setStatus("loading");

    const controller = new AbortController();
    self.controller = controller;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("no-token");

      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ text: textRef.current }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`speak-${res.status}`);

      const blob = await res.blob();
      if (controller.signal.aborted) return;

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      self.url = url;
      self.audio = audio;
      self.controller = null;

      audio.onended = finish;
      audio.onerror = () => {
        finish();
        toast.error("Voice playback failed");
      };

      setStatus("playing");
      await audio.play();
    } catch (err) {
      // Intentional stop/replacement — stay quiet.
      if (controller.signal.aborted || (err as { name?: string })?.name === "AbortError") {
        return;
      }
      finish();
      toast.error("Voice playback failed");
    }
  };

  const toggle = () => {
    if (status === "playing" || status === "loading") self.stop();
    else void play();
  };

  // Release audio + abort any in-flight request if the message unmounts.
  useEffect(() => () => self.stop(), [self]);

  return { status, toggle };
}

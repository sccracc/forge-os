"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Mic, ArrowUp, Square, ChevronDown, X, Sparkles, Bot, Image as ImageIcon, FileText, Loader2 } from "lucide-react";
import { ModelMenu } from "./model-menu";
import { AgentMenu } from "./agent-menu";
import { useComposerStore } from "@/lib/store/composer-store";
import { useEnabledSkills } from "@/hooks/use-skills";
import { useAgents } from "@/hooks/use-agents";
import { FORGE_MODELS_PUBLIC } from "@/lib/ai/models.public";
import { EFFORT } from "@/lib/ai/effort";
import { toast } from "@/lib/store/toast-store";
import { getAccessToken } from "@/lib/supabase/client";
import { UsageIndicator } from "./usage-indicator";
import { useUsageStore } from "@/lib/store/usage-store";
import { tokenStatus } from "@/lib/usage/compute";
import { usePlan } from "@/lib/plans/use-plan";
import { getFeatureLimit, getUpgradeMessage, getRequiredPlan } from "@/lib/plans/gates";
import { IMAGE_MIME_TYPES, type ImageMimeType, type OutgoingAttachments, type Skill } from "@/lib/data/types";
import { isImageMimeType } from "@/lib/data/attachments";
import { parsePdf, rasterizePdf } from "@/lib/pdf/parse";
import { uid as genId } from "@/lib/utils";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 60;

type ComposerAttachment =
  | { kind: "image"; id: string; base64: string; mimeType: ImageMimeType; previewUrl: string; name: string }
  | { kind: "document"; id: string; name: string; text: string; pageCount: number }
  | { kind: "scanned"; id: string; name: string; pages: { base64: string; mimeType: ImageMimeType }[] };

interface ComposerProps {
  onSend: (text: string, attachments: OutgoingAttachments) => void;
  streaming: boolean;
  onStop: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Prefill from an empty-state suggestion; bump `n` to re-seed the same text. */
  seed?: { text: string; n: number } | null;
}

export function Composer({
  onSend,
  streaming,
  onStop,
  placeholder = "Message Forge OS…",
  autoFocus,
  seed,
}: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [parsingCount, setParsingCount] = useState(0);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [justTranscribed, setJustTranscribed] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [modelFlash, setModelFlash] = useState(false);
  const [sendFlying, setSendFlying] = useState(false);
  const firstModelRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const addAnchorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const model = useComposerStore((s) => s.model);
  const effort = useComposerStore((s) => s.effort);
  const thinking = useComposerStore((s) => s.thinking);
  const usageSnapshot = useUsageStore((s) => s.usage);
  const usagePlan = useUsageStore((s) => s.plan);
  const refreshUsage = useUsageStore((s) => s.refresh);
  const usageFull = usageSnapshot ? tokenStatus(usagePlan, usageSnapshot).full : false;
  const plan = usePlan();
  const openGate = useUsageStore((s) => s.openGate);
  const imageUnderstandingLocked = getFeatureLimit(plan, "vision") === 0;
  const documentAnalysisLocked = getFeatureLimit(plan, "documents") === 0;
  const voiceInputLocked = getFeatureLimit(plan, "voice_input_minutes") === 0;
  const activeSkillSlugs = useComposerStore((s) => s.activeSkillSlugs);
  const addSkill = useComposerStore((s) => s.addSkill);
  const removeSkill = useComposerStore((s) => s.removeSkill);
  const activeAgentId = useComposerStore((s) => s.activeAgentId);
  const setAgent = useComposerStore((s) => s.setAgent);
  const { skills } = useEnabledSkills();
  const { agents } = useAgents();
  const activeAgent = agents.find((a) => a.id === activeAgentId);

  const skillBySlug = useMemo(() => {
    const m = new Map<string, Skill>();
    skills.forEach((s) => m.set(s.slug, s));
    return m;
  }, [skills]);

  // Slash picker: active when the draft is a single "/token" with no space yet.
  const slashMatch = /^\/(\S*)$/.exec(draft);
  const pickerOpen = slashMatch !== null;
  const pickerQuery = slashMatch?.[1].toLowerCase() ?? "";
  const pickerResults = useMemo(() => {
    if (!pickerOpen) return [];
    return skills.filter(
      (s) =>
        !activeSkillSlugs.includes(s.slug) &&
        (s.slug.includes(pickerQuery) ||
          s.name.toLowerCase().includes(pickerQuery))
    );
  }, [pickerOpen, pickerQuery, skills, activeSkillSlugs]);

  useEffect(() => setPickerIndex(0), [pickerQuery]);

  // #07 · presentational: once the open cascade has played (~500ms covers the
  // longest item delay + duration), `.settled` disables the item entrances so
  // rows that re-render on filter keystrokes appear instantly instead of
  // replaying their delayed cascade.
  const [pickerSettled, setPickerSettled] = useState(false);
  useEffect(() => {
    if (!pickerOpen) {
      setPickerSettled(false);
      return;
    }
    const t = setTimeout(() => setPickerSettled(true), 500);
    return () => clearTimeout(t);
  }, [pickerOpen]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  // Load current usage for the indicator (also refreshed after each send).
  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    if (seed && seed.text) {
      setDraft(seed.text);
      taRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n]);

  // #30 · flash the model pill when the active model changes.
  useEffect(() => {
    if (firstModelRef.current) {
      firstModelRef.current = false;
      return;
    }
    setModelFlash(true);
    const t = setTimeout(() => setModelFlash(false), 600);
    return () => clearTimeout(t);
  }, [model]);

  // #23 · presentational beat when a transcription lands: droplet hop toward
  // the input + capsule bloom (~700ms, purely decorative).
  useEffect(() => {
    if (!justTranscribed) return;
    const t = setTimeout(() => setJustTranscribed(false), 700);
    return () => clearTimeout(t);
  }, [justTranscribed]);

  // autosize
  const resize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  };
  useEffect(resize, [draft]);

  // close model menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addAnchorRef.current && !addAnchorRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [addMenuOpen]);

  const selectSkill = (s: Skill) => {
    addSkill(s.slug);
    setDraft("");
    taRef.current?.focus();
  };

  const openSkillCommand = () => {
    setDraft((d) => (d.startsWith("/") ? d : "/"));
    setAddMenuOpen(false);
    taRef.current?.focus();
  };

  const openFilePicker = () => {
    setAddMenuOpen(false);
    fileInputRef.current?.click();
  };

  const removeAttachment = (id: string) =>
    setAttachments((list) => list.filter((a) => a.id !== id));

  const readImageFile = (file: File) =>
    new Promise<ComposerAttachment | null>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const previewUrl = typeof reader.result === "string" ? reader.result : "";
        const comma = previewUrl.indexOf(",");
        const base64 = comma >= 0 ? previewUrl.slice(comma + 1) : previewUrl;
        if (!base64) return resolve(null);
        resolve({
          kind: "image",
          id: genId("att"),
          base64,
          mimeType: file.type as ImageMimeType,
          previewUrl,
          name: file.name,
        });
      };
      reader.readAsDataURL(file);
    });

  // Single funnel for the picker, drag-drop, and paste. Routes by type and
  // respects the per-feature plan gates (vision for images, documents for
  // scanned PDFs; text-extractable PDFs are free).
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    for (const file of files) {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

      if (isImageMimeType(file.type)) {
        if (imageUnderstandingLocked) {
          openGate({
            feature: "vision",
            message: getUpgradeMessage(plan, "Image understanding"),
            requiredPlan: getRequiredPlan("Image understanding"),
          });
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(`${file.name} is over 10MB`);
          continue;
        }
        const att = await readImageFile(file);
        if (att) setAttachments((list) => [...list, att]);
        else toast.error(`Couldn't attach ${file.name}`);
        continue;
      }

      if (isPdf) {
        if (file.size > MAX_PDF_BYTES) {
          toast.error(`${file.name} is over 25MB`);
          continue;
        }
        setParsingCount((n) => n + 1);
        try {
          const parsed = await parsePdf(file);
          if (parsed.hasTextLayer) {
            // Free path — extracted client-side, no AI, no quota.
            setAttachments((list) => [
              ...list,
              { kind: "document", id: genId("att"), name: file.name, text: parsed.text, pageCount: parsed.pageCount },
            ]);
          } else {
            // Scanned PDF needs AI analysis → gated as "Document analysis".
            if (documentAnalysisLocked) {
              openGate({
                feature: "documents",
                message: getUpgradeMessage(plan, "Document analysis"),
                requiredPlan: getRequiredPlan("Document analysis"),
              });
              continue;
            }
            const pages = await rasterizePdf(file);
            if (!pages.length) {
              toast.error(`Couldn't read ${file.name}`);
              continue;
            }
            setAttachments((list) => [
              ...list,
              { kind: "scanned", id: genId("att"), name: file.name, pages },
            ]);
          }
        } catch {
          toast.error(`Couldn't read ${file.name}`);
        } finally {
          setParsingCount((n) => Math.max(0, n - 1));
        }
        continue;
      }

      toast.error(`Unsupported file: ${file.name}`);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.currentTarget.value = "";
    void addFiles(files);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter(
      (f) => isImageMimeType(f.type) || f.type === "application/pdf"
    );
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) void addFiles(files);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
      e.preventDefault();
      if (!isDragging) setIsDragging(true);
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    // Only clear when the cursor actually leaves the wrap (not child elements).
    if (e.currentTarget === e.target) setIsDragging(false);
  };

  const toOutgoing = (): OutgoingAttachments => ({
    images: attachments
      .filter((a): a is Extract<ComposerAttachment, { kind: "image" }> => a.kind === "image")
      .map((a) => ({ type: "image", base64: a.base64, mimeType: a.mimeType })),
    documents: attachments
      .filter((a): a is Extract<ComposerAttachment, { kind: "document" }> => a.kind === "document")
      .map((a) => ({ name: a.name, text: a.text })),
    scannedPdfs: attachments
      .filter((a): a is Extract<ComposerAttachment, { kind: "scanned" }> => a.kind === "scanned")
      .map((a) => ({ name: a.name, pages: a.pages })),
  });

  const doSend = () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || streaming || parsingCount > 0) return;
    onSend(text, toOutgoing());
    setDraft("");
    setAttachments([]);
    // Arrow flies out the top and swoops back (CSS .flying → sendFly).
    setSendFlying(true);
    window.setTimeout(() => setSendFlying(false), 500);
    requestAnimationFrame(resize);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && pickerResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIndex((i) => Math.min(i + 1, pickerResults.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectSkill(pickerResults[pickerIndex]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  // --- Voice input (mic → Groq Whisper). Records audio with MediaRecorder,
  // posts it to /api/voice/transcribe, and inserts the transcript at the caret.
  const formatRecordingTime = (total: number) => {
    const clamped = Math.min(Math.max(total, 0), MAX_RECORDING_SECONDS);
    const m = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const clearRecordTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const stopMediaTracks = () => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  };

  // Insert transcribed text at the caret (or append), then restore the caret.
  const insertTranscript = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const ta = taRef.current;
    setDraft((prev) => {
      if (!ta) return prev ? `${prev.replace(/\s*$/, "")} ${clean}` : clean;
      const start = ta.selectionStart ?? prev.length;
      const end = ta.selectionEnd ?? prev.length;
      const before = prev.slice(0, start);
      const after = prev.slice(end);
      const left = before && !/\s$/.test(before) ? `${before} ` : before;
      const right = after && !/^\s/.test(after) ? ` ${after}` : after;
      const caret = (left + clean).length;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(caret, caret);
        resize();
      });
      return `${left}${clean}${right}`;
    });
  };

  const transcribeRecording = async (chunks: Blob[]) => {
    const type = chunks[0]?.type || "audio/webm";
    const blob = new Blob(chunks, { type });
    if (blob.size === 0) {
      toast.error("Transcription failed. Please try again.");
      setIsTranscribing(false);
      return;
    }
    try {
      const token = await getAccessToken();
      if (!token) {
        toast.error("Transcription failed. Please try again.");
        return;
      }
      // Name the upload after the ACTUAL container the browser produced —
      // Safari records audio/mp4, not webm, and a mismatched filename can
      // fail the transcriber's decode.
      const ext = type.includes("mp4")
        ? "m4a"
        : type.includes("ogg")
          ? "ogg"
          : type.includes("mpeg")
            ? "mp3"
            : "webm";
      const form = new FormData();
      form.append("audio", blob, `audio.${ext}`);
      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error(`transcribe ${res.status}`);
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim();
      if (text) {
        insertTranscript(text);
        setJustTranscribed(true); // #23 · droplet + bloom beat
      } else {
        toast.info("No speech detected. Try again.");
      }
    } catch {
      toast.error("Transcription failed. Please try again.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const stopRecording = () => {
    clearRecordTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // fires onstop → cleanup + transcribe
    } else {
      stopMediaTracks();
      setIsRecording(false);
      setRecordingSeconds(0);
    }
  };

  const startRecording = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(
        "Microphone access denied. Please allow microphone access in your browser settings."
      );
      return;
    }
    let recorder: MediaRecorder;
    try {
      // Pick an explicitly supported container so the blob's type is known
      // (Chrome/Firefox: webm+opus; Safari: mp4) instead of relying on the
      // browser default and mislabeling the upload.
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType =
        typeof MediaRecorder.isTypeSupported === "function"
          ? candidates.find((t) => MediaRecorder.isTypeSupported(t))
          : undefined;
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }

    mediaStreamRef.current = stream;
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      clearRecordTimer();
      stopMediaTracks();
      setIsRecording(false);
      setRecordingSeconds(0);
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      mediaRecorderRef.current = null;
      if (chunks.length === 0) return;
      setIsTranscribing(true);
      void transcribeRecording(chunks);
    };

    recorder.start(100); // gather data in 100ms timeslices
    setIsRecording(true);
    setRecordingSeconds(0);
    recordTimerRef.current = setInterval(() => {
      setRecordingSeconds((s) => {
        const next = s + 1;
        if (next >= MAX_RECORDING_SECONDS) queueMicrotask(stopRecording);
        return Math.min(next, MAX_RECORDING_SECONDS);
      });
    }, 1000);
  };

  const toggleMic = () => {
    if (voiceInputLocked) {
      openGate({
        feature: "voice_input",
        message: getUpgradeMessage(plan, "Voice input"),
        requiredPlan: getRequiredPlan("Voice input"),
      });
      return;
    }
    if (isTranscribing) return;
    if (isRecording) stopRecording();
    else void startRecording();
  };

  // Stop recording + release the mic if the composer unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div
      className={`composer-wrap ${isDragging ? "dragging" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="composer-dropzone" aria-hidden>
          <ImageIcon size={22} />
          <span>Drop images or PDFs to attach</span>
        </div>
      )}
      {(activeSkillSlugs.length > 0 || activeAgent) && (
        <div className="composer-chips">
          {activeAgent && (
            <span className="ctx-chip agent" key="__agent">
              <Bot />
              {activeAgent.avatar ? `${activeAgent.avatar} ` : ""}
              {activeAgent.name}
              <span className="rm" onClick={() => setAgent(null)} role="button" aria-label="Remove agent">
                <X size={11} />
              </span>
            </span>
          )}
          {activeSkillSlugs.map((slug) => (
            <span className="ctx-chip" key={slug}>
              <Sparkles />
              {skillBySlug.get(slug)?.name ?? slug}
              <span className="rm" onClick={() => removeSkill(slug)} role="button" aria-label="Remove skill">
                <X size={11} />
              </span>
            </span>
          ))}
        </div>
      )}

      <div
        className={`composer${justTranscribed ? " composer-bloom" : ""}`}
        style={{ position: "relative" }}
      >
        {/* slash / skills picker */}
        <AnimatePresence>
          {pickerOpen && (
            <div
              className={`popover menu-cascade${pickerSettled ? " settled" : ""}`}
              style={{ left: 4, bottom: "calc(100% + 8px)" }}
            >
              {pickerResults.length === 0 ? (
                <div className="popover-empty">
                  {skills.length === 0
                    ? "No skills yet. Create skills in Settings → Skills."
                    : "No matching skills."}
                </div>
              ) : (
                pickerResults.map((s, i) => (
                  <div
                    key={s.id}
                    className={`popover-item ${i === pickerIndex ? "active" : ""}`}
                    onMouseEnter={() => setPickerIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSkill(s);
                    }}
                  >
                    <div className="pi-icon">
                      <Sparkles size={15} />
                    </div>
                    <div className="pi-main">
                      <div className="pi-title">
                        {s.name} <span className="pi-cmd">/{s.slug}</span>
                      </div>
                      <div className="pi-sub">{s.description}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </AnimatePresence>

        {(attachments.length > 0 || parsingCount > 0) && (
          <div className="composer-attachments">
            {attachments.map((att) =>
              att.kind === "image" ? (
                <div className="attachment-chip image" key={att.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={att.previewUrl} alt="" />
                  <small title={att.name}>{att.name}</small>
                  <button
                    className="attachment-remove"
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    aria-label="Remove attachment"
                    title="Remove"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div
                  className={`attachment-chip doc ${att.kind === "scanned" ? "scanned" : ""}`}
                  key={att.id}
                >
                  <FileText size={16} />
                  <div className="attachment-meta">
                    <small title={att.name}>{att.name}</small>
                    <span className="attachment-sub">
                      {att.kind === "scanned"
                        ? `${att.pages.length} page${att.pages.length > 1 ? "s" : ""} · AI-read`
                        : `${att.pageCount} page${att.pageCount > 1 ? "s" : ""} · text`}
                    </span>
                  </div>
                  <button
                    className="attachment-remove"
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    aria-label="Remove attachment"
                    title="Remove"
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            )}
            {parsingCount > 0 && (
              <div className="attachment-chip doc parsing">
                <Loader2 size={15} className="spin" />
                <small>Reading PDF…</small>
              </div>
            )}
          </div>
        )}

        <textarea
          ref={taRef}
          className="composer-input"
          rows={1}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-label="Message Forge OS"
        />

        <div className="composer-bar">
          <div className="menu-anchor" ref={addAnchorRef}>
            <button
              className={`c-icon ${addMenuOpen ? "active" : ""}`}
              data-tip="Add"
              onClick={() => setAddMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              type="button"
            >
              <Plus />
            </button>

            <AnimatePresence>
              {addMenuOpen && (
                <motion.div
                  className="popover add-pop menu-cascade"
                  role="menu"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                  style={{ bottom: "calc(100% + 8px)", left: 0 }}
                >
                  <button className="popover-item" role="menuitem" type="button" onClick={openSkillCommand}>
                    <div className="pi-icon">
                      <Sparkles size={15} />
                    </div>
                    <div className="pi-main">
                      <div className="pi-title">Skill or command</div>
                    </div>
                  </button>
                  <button
                    className="popover-item"
                    role="menuitem"
                    type="button"
                    onClick={openFilePicker}
                  >
                    <div className="pi-icon">
                      <ImageIcon size={15} />
                    </div>
                    <div className="pi-main">
                      <div className="pi-title">Attach image or PDF</div>
                    </div>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={[...IMAGE_MIME_TYPES, "application/pdf"].join(",")}
              onChange={onFileInputChange}
              style={{ display: "none" }}
            />
          </div>

          <AgentMenu />

          <div className="composer-spacer" />

          <UsageIndicator />

          <div className="menu-anchor" ref={anchorRef}>
            <button
              className={`model-trigger ${menuOpen ? "open" : ""} ${modelFlash ? "flash" : ""}`}
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {/* Keyed by value so a model/effort change remounts the label
                  with the swap-in morph (blur-rise). */}
              <b key={`m-${model}`} className="swap-in">{FORGE_MODELS_PUBLIC[model].label}</b>
              <span key={`e-${effort}`} className="effort-tag swap-in">{EFFORT[effort].label}</span>
              {thinking && <span className="thinking-tag">Thinking</span>}
              <ChevronDown className="chev" />
            </button>
            <AnimatePresence>{menuOpen && <ModelMenu />}</AnimatePresence>
          </div>

          {isRecording && (
            <span className="rec-timer" aria-live="polite">
              <span className="rec-dot" aria-hidden />
              {formatRecordingTime(recordingSeconds)}
            </span>
          )}

          <button
            className={`c-icon mic-btn ${isRecording ? "recording" : ""}`}
            data-tip={
              isTranscribing ? "Transcribing…" : isRecording ? "Stop recording" : "Dictate"
            }
            onClick={toggleMic}
            disabled={isTranscribing}
            type="button"
            aria-label={isRecording ? "Stop recording" : "Start voice input"}
          >
            {isTranscribing ? (
              <span className="mic-spinner" aria-hidden />
            ) : isRecording ? (
              // #22 · live waveform bars while recording (button keeps stop semantics)
              <span className="mic-wave" aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
            ) : (
              <Mic />
            )}
          </button>

          {justTranscribed && <span className="transcribe-drop" aria-hidden />}

          {streaming ? (
            <button className="send-btn stop" title="Stop" onClick={onStop}>
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className={`send-btn${sendFlying ? " flying" : ""}`}
              title="Send"
              onClick={doSend}
              disabled={(!draft.trim() && attachments.length === 0) || usageFull || parsingCount > 0}
            >
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

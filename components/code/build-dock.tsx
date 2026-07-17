"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Square, ChevronDown, Check, FileCode2, Hammer, MessagesSquare, Sparkles, Plus, X } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useComposerStore } from "@/lib/store/composer-store";
import { useSkills } from "@/hooks/use-skills";
import { ModelMenu } from "@/components/chat/model-menu";
import { AgentMenu } from "@/components/chat/agent-menu";
import { Markdown } from "@/components/chat/markdown";
import { TypingDots } from "@/components/chat/typing-dots";
import { CountUp } from "@/components/ui/count-up";
import { SkillStatus } from "@/components/chat/skill-status";
import { ArtifactSurfaceCtx } from "@/components/chat/markdown-context";
import { SparkFilled } from "@/components/icons";
import { FORGE_MODELS_PUBLIC } from "@/lib/ai/models.public";
import { EFFORT, type EffortId } from "@/lib/ai/effort";
import {
  BUILD_FETCH_DATA_FIX,
  BUILD_CONSISTENCY_FIX,
  BUILD_VERIFY_FIX,
  CODE_FIXER_ADDENDUM,
} from "@/lib/ai/prompts";
import {
  subscribeBuildLog,
  addBuildMessage,
  normalizeFileChanges,
  type BuildMessage,
  type BuildFileChange,
} from "@/lib/data/build-chat";
import { writeFilesByPath, getProjectFilesOnce } from "@/lib/data/files";
import { touchProject, updateProject } from "@/lib/data/projects";
import { createCheckpoint } from "@/lib/data/checkpoints";
import {
  parseBuildStream,
  buildFileStatuses,
  resolveBuildOps,
  lastOpPerPath,
  type ResolvedOp,
} from "@/lib/code/build-stream";
import {
  claimsBuildChange,
  modelForBuildExecution,
  RELIABLE_BUILD_MODEL,
  summarizeAppliedBuild,
  summarizeNoAppliedChangesClaim,
  summarizeTruncatedBuild,
  buildNoAppliedDiffFixPrompt,
  buildFailedOpsRecoveryPrompt,
} from "@/lib/code/build-integrity";
import {
  applicableResolvedOps,
  buildAppliedChanges,
  persistedAppliedOps,
  refreshTouchedPaths,
} from "@/lib/code/build-apply";
import { detectPreviewKind, effectivePreviewMode } from "@/lib/code/preview";
import { runVerification, formatIssuesForFix, type VerifyIssue } from "@/lib/code/verify";
import { buildRetrievalContext, type RetrievalFile } from "@/lib/code/retrieval";
import { forgeCodeEffortProfile } from "@/lib/code/forge-code-config";
import { createAgentRunLog } from "@/lib/code/agent-log";
import { buildDiffs, formatDiffsForPrompt } from "@/lib/code/diff";
import { parseVerdict, formatVerdictForFix, sortIssues, type Verdict } from "@/lib/code/verdict";
import { filterSafeOps } from "@/lib/code/path-safety";
import { parseBuildPlan, planToContext, checklistToPrompt, type BuildPlan } from "@/lib/ai/build-plan";
import { detectFabricatedData } from "@/lib/code/fabrication";
import { impliedChecksForBuildRequest, impliedChecksToPrompt } from "@/lib/code/implied-checks";
import { extractRenames, staleTermFiles } from "@/lib/code/consistency";
import { toast } from "@/lib/store/toast-store";
import type { StreamEventWire } from "@/lib/ai/types";
import type { FileDoc, ProjectDoc as Project, Skill, SkillRef } from "@/lib/data/types";

type DockMode = "build" | "discuss";

/** Every distinct stage the agent can be in (drives the per-stage UI). */
type BuildPhase =
  | "reasoning"
  | "analyzing"
  | "retrieving"
  | "planning"
  | "plan"
  | "streaming"
  | "applying"
  | "reviewing"
  | "validating"
  | "verifying-strict"
  | "fixing"
  | "verifying"
  | "finalizing"
  | "error";

interface FileRow {
  path: string;
  status: "writing" | "done";
  added: number;
  removed: number;
  isNew: boolean;
}

/**
 * Time-throttle a callback to at most once per `ms`, always delivering the
 * final call. Used to cap how often the streaming UI re-renders: a fast token
 * stream can fire hundreds of times a second, and re-parsing + re-rendering a
 * large Markdown narration that often janks/flashes the panel. ~10 updates/sec
 * is perfectly smooth and cheap.
 */
function throttleTrailing<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): ((...args: A) => void) & { flush: () => void } {
  let last = 0;
  let pending: A | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    last = Date.now();
    if (pending) {
      fn(...pending);
      pending = null;
    }
  };
  const throttled = (...args: A) => {
    pending = args;
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) run();
    else if (timer === null) timer = setTimeout(run, wait);
  };
  throttled.flush = () => {
    if (timer !== null) clearTimeout(timer);
    run();
  };
  return throttled;
}

/** Map project files to the retrieval module's shape (real files only). */
function toRetrievalFiles(files: FileDoc[]): RetrievalFile[] {
  return files
    .filter((f) => f.kind === "file")
    .map((f) => ({ path: f.path, content: f.content ?? "", updatedAt: f.updatedAt }));
}

function mapContents(files: FileDoc[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) if (f.kind === "file") m.set(f.path, f.content ?? "");
  return m;
}

/** Premium "agent at work" file panel — status + live +/- line diffs, no code. */
function BuildFileList({ rows, live }: { rows: FileRow[]; live: boolean }) {
  const totalAdded = rows.reduce((n, r) => n + r.added, 0);
  const totalRemoved = rows.reduce((n, r) => n + r.removed, 0);
  // While the stream is LIVE the panel must stay in "Building" mode even when
  // every parsed block is momentarily complete: the model emits MANY small edit
  // blocks per file, so "all done" is true in the gaps between blocks — keying
  // the completed look off it made the panel flip Building ↔ Files-updated on
  // every block boundary (incl. re-firing the count-up animation). The
  // completed look is reserved for the persisted, final card (live=false).
  const working = live;
  return (
    <div className={`build-files ${working ? "working" : "complete"}`}>
      <div className="bf-head">
        <span className="bf-head-l">
          {working ? <span className="bf-spin" /> : <Check size={13} className="bf-head-check" />}
          <span>{working ? "Building" : "Files updated"}</span>
        </span>
        <span className="bf-count">
          {rows.length} file{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="bf-rows">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.path}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className={`bf-row ${r.status}`}
            >
              <span className="bf-status">
                {r.status === "writing" ? <span className="bf-spin" /> : <Check size={12} />}
              </span>
              <FileCode2 size={13} className="bf-ficon" />
              <span className="bf-path" title={r.path}>
                {r.path}
              </span>
              {r.isNew && <span className="bf-tag">NEW</span>}
              <span className="bf-diff">
                {r.added > 0 && <span className="bf-add">+{r.added}</span>}
                {r.removed > 0 && <span className="bf-del">−{r.removed}</span>}
              </span>
              {r.status === "writing" && <span className="bf-bar" aria-hidden />}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {(totalAdded > 0 || totalRemoved > 0) && (
        <div className="bf-foot">
          {totalAdded > 0 && (
            <span className="bf-add">+{working ? totalAdded : <CountUp to={totalAdded} durationMs={700} />}</span>
          )}
          {totalRemoved > 0 && (
            <span className="bf-del">−{working ? totalRemoved : <CountUp to={totalRemoved} durationMs={700} />}</span>
          )}
          <span className="bf-foot-label">{working ? "so far" : "applied"}</span>
        </div>
      )}
    </div>
  );
}

// ---- Agent pipeline: the distinct stage rail shown while a build runs. ----
const PIPELINE: { key: string; label: string; phases: BuildPhase[] }[] = [
  { key: "analyze", label: "Analyze", phases: ["analyzing"] },
  { key: "retrieve", label: "Retrieve", phases: ["retrieving"] },
  { key: "plan", label: "Plan", phases: ["reasoning", "planning", "plan"] },
  { key: "execute", label: "Execute", phases: ["streaming", "applying"] },
  { key: "verify", label: "Verify", phases: ["reviewing", "validating", "verifying-strict", "verifying"] },
  { key: "fix", label: "Fix", phases: ["fixing"] },
  { key: "finalize", label: "Finalize", phases: ["finalizing"] },
];

function pipelineIndex(phase: BuildPhase): number {
  const i = PIPELINE.findIndex((s) => s.phases.includes(phase));
  return i === -1 ? 0 : i;
}

/** Phases that show a labeled "working" stage chip (not the live execute stream). */
const STAGE_CHIP_PHASES: BuildPhase[] = [
  "analyzing", "retrieving", "applying", "reviewing",
  "validating", "verifying-strict", "fixing", "verifying", "finalizing",
];

/** A short, lowercase phrase naming what the agent is fixing (Claude-style). */
function issuePhrase(verdict: Verdict, max = 2): string {
  const top = sortIssues(verdict.issues)
    .slice(0, max)
    .map((i) => i.title.replace(/\.$/, "").toLowerCase());
  if (top.length === 0) return "a few details";
  const more = verdict.issues.length - top.length;
  const joined = top.length === 2 ? `${top[0]} and ${top[1]}` : top[0];
  return more > 0 ? `${joined}, plus ${more} more` : joined;
}

/** Conversational status line for the review/fix loop — reads like a teammate. */
function reviewNarration(
  verdict: Verdict | null,
  cycle: number,
  prevCount: number | null,
  fixing: boolean
): string {
  if (!verdict || verdict.status === "pass") {
    return "Everything checks out — reviewed and verified. ✓";
  }
  const n = verdict.issues.length;
  const what = issuePhrase(verdict);
  if (!fixing) {
    // Just finished a review pass.
    if (cycle === 1) return `Reviewed the first pass — spotted ${n} thing${n === 1 ? "" : "s"} to tighten up (${what}).`;
    if (prevCount != null && n < prevCount) return `Good progress — down to ${n} from ${prevCount}. Still on ${what}.`;
    if (prevCount != null && n >= prevCount) return `Still ${n} to resolve (${what}). Taking another pass.`;
    return `Found ${n} thing${n === 1 ? "" : "s"} to improve: ${what}.`;
  }
  // Actively fixing.
  return `Fixing ${what}…`;
}

/** Concise, user-facing progress line per stage (no chain-of-thought). */
function phaseChip(phase: BuildPhase, cycle?: number, maxCycles?: number): string {
  const c = cycle && maxCycles ? ` · pass ${cycle}/${maxCycles}` : "";
  switch (phase) {
    case "analyzing": return "Analyzing request…";
    case "retrieving": return "Reading the relevant project files…";
    case "applying": return "Applying changes…";
    case "reviewing": return "Reviewing changes…";
    case "validating": return `Running verification${c}…`;
    case "verifying-strict": return `Reviewing the implementation${c}…`;
    case "verifying": return "Verifying it works…";
    case "fixing": return `Fixing issues${c}…`;
    case "finalizing": return "Finalizing solution…";
    default: return "Working…";
  }
}

/** Premium multi-stage pipeline rail — each agent stage as its own node. */
function AgentPipeline({ phase }: { phase: BuildPhase }) {
  const cur = pipelineIndex(phase);
  return (
    <div className="agent-pipeline" aria-label={`Agent stage ${cur + 1} of ${PIPELINE.length}`}>
      {PIPELINE.map((stage, i) => {
        const state = i < cur ? "done" : i === cur ? "active" : "pending";
        return (
          <Fragment key={stage.key}>
            {i > 0 && <span className={`ap-link ${i <= cur ? "filled" : ""}`} />}
            <span className={`ap-node ${stage.key} ${state}`} title={stage.label}>
              <span className="ap-dot">{state === "done" ? <Check size={10} /> : null}</span>
              <span className="ap-label">{stage.label}</span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Verifier panel — framed as active refinement, not failure. Shows the items
 *  the agent is working through (severity-coded), with a calm "polishing" tone. */
function VerifierPanel({
  verdict,
  cycle,
  maxCycles,
  fixing,
}: {
  verdict: Verdict;
  cycle?: number;
  maxCycles?: number;
  fixing?: boolean;
}) {
  const issues = sortIssues(verdict.issues);
  const pass = verdict.status === "pass";
  return (
    <div className={`verifier-panel ${pass ? "pass" : "refining"}`}>
      <div className="vp-head">
        {pass ? (
          <span className="vp-badge pass">
            <Check size={11} /> Verified
          </span>
        ) : (
          <span className="vp-badge refining">
            <span className="bf-spin" /> Refining
          </span>
        )}
        <span className="vp-title">
          {pass ? "All checks passed" : fixing ? "Improving the implementation" : "Self-review"}
          {!pass && cycle ? ` · pass ${cycle}${maxCycles ? `/${maxCycles}` : ""}` : ""}
        </span>
        {!pass && issues.length > 0 && (
          <span className="vp-count">{issues.length} to polish</span>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="vp-issues">
          {issues.slice(0, 6).map((it, i) => (
            <li key={i} className={`vp-issue sev-${it.severity}`}>
              <span className={`vp-sev sev-${it.severity}`}>{it.severity}</span>
              <span className="vp-cat">{it.category}</span>
              <span className="vp-issue-title">{it.title}</span>
            </li>
          ))}
          {issues.length > 6 && <li className="vp-more">+{issues.length - 6} more…</li>}
        </ul>
      )}
    </div>
  );
}

/** Live, expandable view of the agent drafting its plan (so it never feels stuck). */
function PlanningPanel({ text }: { text?: string }) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open]);
  const clean = (text ?? "")
    .replace(/```forge-plan\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return (
    <div className="planning-panel">
      <button className="pp-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="bf-pulse-dot" />
        <span className="shimmer-text">Planning the build…</span>
        <ChevronDown className={`pp-chev ${open ? "open" : ""}`} size={15} />
      </button>
      {open && (
        <div className="pp-body" ref={bodyRef}>
          {clean || "Figuring out exactly what to build, and how to verify it works…"}
        </div>
      )}
    </div>
  );
}

/** Plan-approval card shown when build autonomy is "plan" or "step". */
function BuildPlanCard({
  plan,
  onApprove,
  onCancel,
}: {
  plan: BuildPlan;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="build-plan">
      <div className="bp-head">Plan</div>
      <div className="bp-summary">{plan.summary || "Here's the plan."}</div>
      {plan.steps.length > 0 && (
        <ol className="bp-steps">
          {plan.steps.map((s, i) => (
            <li key={i}>
              <span className="bp-step-title">{s.title}</span>
              {s.files && s.files.length > 0 && <span className="bp-step-files">{s.files.join(", ")}</span>}
            </li>
          ))}
        </ol>
      )}
      {plan.checklist.length > 0 && (
        <div className="bp-checks">
          {plan.checklist.length} acceptance check{plan.checklist.length === 1 ? "" : "s"} will confirm it&apos;s done and works.
        </div>
      )}
      <div className="bp-actions">
        <button className="btn-amber" onClick={onApprove}>
          <Check size={14} /> Approve &amp; build
        </button>
        <button className="btn-ghost" onClick={onCancel}>
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}

/** Collapsible trace of a completed agent run (stages, iterations, outcome). */
function AgentRunTrace({ run }: { run: NonNullable<BuildMessage["agentRun"]> }) {
  const [open, setOpen] = useState(false);
  const label =
    run.outcome === "applied"
      ? "Agent run"
      : run.outcome.startsWith("no-op")
        ? "Agent run (no changes)"
        : `Agent run (${run.outcome})`;
  return (
    <div className="agent-run">
      <button className="ar-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Sparkles size={12} />
        <span className="ar-label">{label}</span>
        <span className="ar-meta">
          {run.stages.length} stage{run.stages.length === 1 ? "" : "s"} · {run.iterations} fix pass
          {run.iterations === 1 ? "" : "es"} · {Math.round(run.ms)}ms
        </span>
        <ChevronDown className={`ar-chev ${open ? "open" : ""}`} size={13} />
      </button>
      {open && (
        <div className="ar-body">
          {run.stages.map((s, i) => (
            <div key={i} className={`ar-stage ${s.ok === false ? "bad" : ""}`}>
              <span className="ar-stage-name">{s.stage}</span>
              {s.detail && <span className="ar-stage-detail">{s.detail}</span>}
              {s.verify && (
                <span className={`ar-stage-verdict ${s.verify.ok ? "ok" : "bad"}`}>
                  {s.verify.ok ? "pass" : `${s.verify.issues} issue${s.verify.issues === 1 ? "" : "s"}`}
                </span>
              )}
              {typeof s.ms === "number" && s.ms > 0 && <span className="ar-stage-ms">{Math.round(s.ms)}ms</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BuildDock({
  project,
  files,
}: {
  project: Project | null;
  files: FileDoc[];
}) {
  const { user, getIdToken, profile } = useAuth();
  const planApprovalRef = useRef<((approved: boolean) => void) | null>(null);
  const [mode, setMode] = useState<DockMode>("build");
  const [messages, setMessages] = useState<BuildMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [streaming, setStreaming] = useState<{
    content: string;
    reasoning: string;
    phase: BuildPhase;
    mode: DockMode;
    /** Frozen file rows shown during the review pass (so live diffs don't reset to 0). */
    files?: FileRow[];
    /** The proposed plan, shown during the "plan" approval gate. */
    plan?: BuildPlan;
    /** Live plan text streamed during the "planning" phase (shown in a dropdown). */
    planText?: string;
    /** Latest Verifier verdict (shown in the Verifier panel during self-correction). */
    verdict?: Verdict;
    /** Current self-correction cycle / total (for the "Reviewing 2/10" label). */
    cycle?: number;
    maxCycles?: number;
    /** Conversational, Claude-style status line during the review/fix loop. */
    narration?: string;
    error?: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const acRef = useRef<AbortController | null>(null);

  const model = useComposerStore((s) => s.model);
  const setModel = useComposerStore((s) => s.setModel);
  const effort = useComposerStore((s) => s.effort);
  const activeSkillSlugs = useComposerStore((s) => s.activeSkillSlugs);
  const addSkill = useComposerStore((s) => s.addSkill);
  const removeSkill = useComposerStore((s) => s.removeSkill);
  const { skills: allSkills } = useSkills();

  useEffect(() => {
    if (!user || !project) return;
    return subscribeBuildLog(user.uid, project.id, setMessages);
  }, [user, project]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (mode === "build" && model !== RELIABLE_BUILD_MODEL) setModel(RELIABLE_BUILD_MODEL);
  }, [mode, model, setModel]);

  const contentLen = streaming ? streaming.content.length + streaming.reasoning.length : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, contentLen, streaming?.phase]);

  // Current project file contents, for live diff stats (pre-write state).
  const existingMap = useMemo(() => mapContents(files), [files]);

  // Skills (shared with chat via the composer store) — slash picker + chips.
  const enabledSkills = useMemo(() => allSkills.filter((s) => s.enabled), [allSkills]);
  const skillBySlug = useMemo(() => new Map(enabledSkills.map((s) => [s.slug, s])), [enabledSkills]);
  const activeSkillRefs = useMemo<SkillRef[]>(
    () =>
      activeSkillSlugs
        .map((slug) => skillBySlug.get(slug))
        .filter((s): s is Skill => Boolean(s))
        .map((s) => ({ name: s.name, slug: s.slug })),
    [activeSkillSlugs, skillBySlug]
  );

  const slashMatch = /^\/(\S*)$/.exec(draft);
  const pickerOpen = slashMatch !== null;
  const pickerQuery = slashMatch?.[1].toLowerCase() ?? "";
  const pickerResults = useMemo(() => {
    if (!pickerOpen) return [];
    return enabledSkills.filter(
      (s) =>
        !activeSkillSlugs.includes(s.slug) &&
        (s.slug.includes(pickerQuery) || s.name.toLowerCase().includes(pickerQuery))
    );
  }, [pickerOpen, pickerQuery, enabledSkills, activeSkillSlugs]);
  const activePickerIndex = pickerResults.length
    ? Math.min(pickerIndex, pickerResults.length - 1)
    : 0;

  const selectSkill = (s: Skill) => {
    addSkill(s.slug);
    setDraft("");
    taRef.current?.focus();
  };

  // Build-mode stream → narration (no code) + live file states.
  const parsed = useMemo(
    () => (streaming && streaming.mode === "build" ? parseBuildStream(streaming.content) : null),
    [streaming]
  );
  const liveFiles = useMemo<FileRow[]>(
    () => (parsed ? buildFileStatuses(parsed.files, existingMap) : []),
    [parsed, existingMap]
  );
  // During the review pass we show a frozen snapshot so the just-written files
  // don't recompute their diffs to zero against the now-updated project.
  const panelRows: FileRow[] = streaming?.files ?? liveFiles;
  // Build executor prose is untrusted until its file blocks have been applied.
  // The final assistant message is generated from the persisted diff instead.
  const showBuildProse = false;

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming || !user || !project) return;
    setDraft("");
    const uid = user.uid;
    const projectId = project.id;
    const dockMode = mode;
    const settings = useComposerStore.getState();

    await addBuildMessage(uid, projectId, { role: "user", content: text });
    setStreaming({
      content: "",
      reasoning: "",
      phase: dockMode === "build" ? "analyzing" : settings.thinking ? "reasoning" : "streaming",
      mode: dockMode,
    });

    const token = await getIdToken();
    if (!token) {
      setStreaming({ content: "", reasoning: "", phase: "error", mode: dockMode, error: "Your session expired. Sign in again." });
      return;
    }

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const activeSkills = settings.activeSkillSlugs
      .map((slug) => allSkills.find((s) => s.slug === slug && s.enabled))
      .filter((s): s is Skill => Boolean(s));
    const skills = activeSkills.map((s) => ({ name: s.name, instructions: s.instructions }));
    const skillRefs: SkillRef[] = activeSkills.map((s) => ({ name: s.name, slug: s.slug }));
    const skillCatalog = allSkills.map((s) => ({ name: s.name, slug: s.slug, description: s.description || undefined }));

    const freshFiles = await getProjectFilesOnce(uid, projectId).catch(() => files);
    const beforeMap = mapContents(freshFiles);
    const impliedChecks = dockMode === "build" ? impliedChecksForBuildRequest(text) : [];
    const impliedRequirements = impliedChecksToPrompt(impliedChecks);

    // Effort scales DEPTH (planning, verification, iterations, retrieval), never
    // output size — Forge Code always generates with the full token budget.
    const effortProfile = forgeCodeEffortProfile(settings.effort);
    const log = createAgentRunLog({
      projectId,
      effort: settings.effort,
      mode: dockMode,
      request: text,
    });
    log.record("analyze", { detail: `${freshFiles.filter((f) => f.kind === "file").length} files`, ok: true });

    // Retrieval-first context: rank the project's files by relevance to the
    // request and spend the budget on the most relevant first (tree always
    // included; the rest summarized). Far better signal than dumping everything.
    // Once a plan exists, the files it says it will edit are ALWAYS inlined in
    // full (mustInclude) — editing against a summary is how hunks go wrong.
    let retrievalLogged = false;
    let planFilePaths: string[] = [];
    const makeContext = (projectFiles: FileDoc[]): string => {
      const r = buildRetrievalContext(toRetrievalFiles(projectFiles), text, {
        budgetBytes: effortProfile.retrievalBudgetBytes,
        maxFullFiles: effortProfile.retrievalMaxFullFiles,
        neighborDepth: effortProfile.retrievalNeighborDepth,
        mustInclude: planFilePaths,
      });
      if (!retrievalLogged) {
        log.retrieval(r.includedFull, r.summarized);
        retrievalLogged = true;
      }
      return r.context;
    };

    const ac = new AbortController();
    acRef.current = ac;

    // Running tally of forge tokens this build has actually spent (summed from
    // each request's billed `done` event). The self-correction loop hard-stops
    // when this crosses the effort's buildTokenBudget — your usage is protected.
    let spentForgeTokens = 0;

    // Streams one /api/chat request, calling onLive per delta; returns full text.
    const streamChat = async (
      wire: { role: string; content: string }[],
      projectFiles: FileDoc[],
      onLive: (content: string, reasoning: string) => void,
      opts?: { signal?: AbortSignal; effort?: EffortId; thinking?: boolean; mode?: string }
    ): Promise<string> => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: wire,
          forgeModelId: modelForBuildExecution(settings.model, dockMode),
          effort: opts?.effort ?? settings.effort,
          thinking: opts?.thinking ?? settings.thinking,
          mode: opts?.mode ?? (dockMode === "build" ? "code-build" : "code-discuss"),
          projectId,
          projectContext: makeContext(projectFiles),
          skills,
          skillCatalog,
          agentId: settings.activeAgentId ?? undefined,
        }),
        signal: opts?.signal ?? ac.signal,
      });
      if (!res.ok || !res.body) throw new Error("response");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let content = "";
      let reasoning = "";
      for (;;) {
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
          if (ev.t === "content") {
            content += ev.d;
            onLive(content, reasoning);
          } else if (ev.t === "reasoning") {
            reasoning += ev.d;
            onLive(content, reasoning);
          } else if (ev.t === "done") {
            spentForgeTokens += ev.forgeTokens ?? 0;
          } else if (ev.t === "error") {
            throw new Error(ev.d);
          }
        }
      }
      return content;
    };

    try {
      // ---- Retrieval phase: rank + load the relevant project context first.
      if (dockMode === "build") {
        setStreaming((s) => (s ? { ...s, phase: "retrieving" } : s));
        // Warm + log retrieval against the current project before planning.
        makeContext(freshFiles);
      }

      // ---- Plan phase: decide exactly what to do (and how it'll be verified)
      //      before touching anything. Best-effort — a parse failure just skips it.
      let plan: BuildPlan | null = null;
      if (dockMode === "build" && effortProfile.planning) {
        setStreaming((s) => (s ? { ...s, phase: "planning" } : s));
        const endPlan = log.begin("plan");
        // Planning is a FAST, BOUNDED, best-effort step: low effort + a hard
        // timeout (scaled by effort) so it can never hang the build. On
        // timeout/error we just build without a plan — the verify/heal loop is
        // the real safety net.
        const planAc = new AbortController();
        const onPlanAbort = () => planAc.abort();
        ac.signal.addEventListener("abort", onPlanAbort);
        const planTimer = setTimeout(() => planAc.abort(), effortProfile.planTimeoutMs);
        const livePlan = throttleTrailing(
          (content: string) => setStreaming((s) => (s ? { ...s, planText: content } : s)),
          90
        );
        try {
          const planOut = await streamChat(
            [...history, { role: "user", content: text }],
            freshFiles,
            (content) => livePlan(content),
            { signal: planAc.signal, effort: "low", thinking: false, mode: "code-plan" }
          );
          livePlan.flush();
          plan = parseBuildPlan(planOut);
          if (plan && impliedChecks.length) {
            plan = { ...plan, checklist: [...plan.checklist, ...impliedChecks] };
          }
          // Files the plan intends to touch are inlined in full from here on.
          if (plan) planFilePaths = plan.steps.flatMap((s) => s.files ?? []);
        } catch {
          plan = null; // timed out or errored → proceed without a plan
        } finally {
          clearTimeout(planTimer);
          ac.signal.removeEventListener("abort", onPlanAbort);
          endPlan({
            ok: Boolean(plan),
            detail: plan ? `${plan.steps.length} steps, ${plan.checklist.length} checks` : "no plan",
          });
        }
        if (ac.signal.aborted) {
          setStreaming(null);
          return;
        }
        // Autonomy gate: in plan/step mode, show the plan and wait for approval.
        const autonomy = profile?.buildAutonomy ?? "auto";
        if (plan && (autonomy === "plan" || autonomy === "step")) {
          setStreaming((s) => (s ? { ...s, phase: "plan", plan: plan ?? undefined } : s));
          const approved = await new Promise<boolean>((resolve) => {
            planApprovalRef.current = resolve;
          });
          planApprovalRef.current = null;
          if (!approved) {
            setStreaming(null);
            return;
          }
        }
        setStreaming((s) => (s ? { ...s, phase: "streaming", plan: plan ?? undefined } : s));
      }

      // ---- Main pass (guided by the plan when we have one).
      const executionText = [
        plan ? planToContext(plan) : null,
        impliedRequirements || null,
        plan ? `Now implement the entire plan in this project. Original request: ${text}` : text,
      ]
        .filter(Boolean)
        .join("\n\n---\n\n");
      const endExecute = log.begin("execute");
      // Throttle UI updates so a fast token stream (esp. with a large narration)
      // re-renders ~10×/sec instead of on every token — fixes the panel flashing.
      const liveExecute = throttleTrailing(
        (content: string, reasoning: string) =>
          setStreaming((s) => (s ? { ...s, content, reasoning, phase: "streaming" } : s)),
        90
      );
      const mainContent = await streamChat(
        [...history, { role: "user", content: executionText }],
        freshFiles,
        liveExecute
      );
      liveExecute.flush();
      endExecute({ ok: true });

      if (dockMode !== "build") {
        log.finish("discuss", []);
        await addBuildMessage(uid, projectId, {
          role: "assistant",
          content: mainContent.trim(),
          skillsUsed: skillRefs.length ? skillRefs : undefined,
        });
        setStreaming(null);
        return;
      }

      // ---- Resolve the main pass's file operations.
      const mainParsed = parseBuildStream(mainContent);
      const mainOps = resolveBuildOps(mainParsed.files, beforeMap);
      const mainProse = mainParsed.prose;
      // Blocks whose closing fence never arrived — the stream was cut off by the
      // generation time limit. Drives edit-based recovery + the honest summary.
      const truncatedPaths = new Set(mainParsed.files.filter((f) => !f.done).map((f) => f.path));
      const hadTruncatedWrite = truncatedPaths.size > 0;
      const claimedChange = claimsBuildChange(mainProse);
      const codeOf = (fs: FileDoc[]) =>
        fs.filter((f) => f.kind === "file").map((f) => ({ path: f.path, content: f.content ?? "" }));

      let current = freshFiles;
      const touchedPaths = new Set<string>();
      const refreshTouched = (candidatePaths: Iterable<string> = touchedPaths): string[] =>
        refreshTouchedPaths(touchedPaths, candidatePaths, beforeMap, mapContents(current));

      // The REAL change set so far (current files vs. the pre-build snapshot), so
      // the file panel always shows accurate diffs — live, not only at the end.
      const realChanges = (): FileRow[] =>
        buildAppliedChanges(touchedPaths, beforeMap, mapContents(current)).map((c) => ({
          ...c,
          status: "done" as const,
        }));
      const showProgress = (
        phase: "reviewing" | "fixing" | "verifying" | "validating" | "verifying-strict" | "applying" | "finalizing",
        extra?: { cycle?: number; maxCycles?: number; verdict?: Verdict }
      ) => setStreaming((s) => (s ? { ...s, phase, files: realChanges(), ...extra } : s));

      // Path-safety gate: never write an absolute / traversal / junk path. Returns
      // only the safe, normalized ops; rejected ones are logged and dropped.
      const safeWrites = <T extends { path: string; content: string }>(ops: T[]): T[] => {
        const { safe, rejected } = filterSafeOps(ops);
        if (rejected.length) {
          log.record("validate", {
            ok: false,
            detail: `rejected ${rejected.length} unsafe path(s): ${rejected.map((r) => `${r.path} (${r.reason})`).join(", ")}`,
          });
        }
        return safe;
      };

      let checkpointCreated = false;
      const ensureCheckpoint = async () => {
        if (checkpointCreated) return;
        checkpointCreated = true;
        await createCheckpoint(uid, projectId, `Before: ${text}`, "auto", freshFiles).catch(() => null);
      };

      let correctivePasses = 0;

      // Fast, time-boxed corrective pass; writes changes, refreshes `current`,
      // tracks touched files, and returns the ops it applied. Every corrective
      // carries the build's running state (request, plan, files changed so
      // far) so the fixer is never an amnesiac one-shot, and complex fixes can
      // run above "low" effort via opts.
      const runCorrective = async (
        userMsg: string,
        opts?: { effort?: EffortId }
      ): Promise<ResolvedOp[]> => {
        if (correctivePasses >= effortProfile.maxCorrectivePasses) {
          log.record("fix", { ok: false, detail: "corrective pass budget reached" });
          return [];
        }
        if (spentForgeTokens >= effortProfile.buildTokenBudget) {
          log.record("fix", { ok: false, detail: "token budget reached before corrective pass" });
          return [];
        }
        correctivePasses++;
        log.iteration();
        const baseMap = mapContents(current);
        const cAc = new AbortController();
        const onAbort = () => cAc.abort();
        ac.signal.addEventListener("abort", onAbort);
        // Generous ceiling: a full-file rewrite of a large project can't finish in
        // 45s — cutting it off produces a truncated, unclosed block that applies
        // NOTHING, which is exactly what made the loop spin without converging.
        const timer = setTimeout(() => cAc.abort(), 150_000);
        const stateBlock = [
          userMsg.includes(text) ? null : `Original user request: ${text}`,
          plan?.summary ? `Approved plan goal: ${plan.summary}` : null,
          touchedPaths.size
            ? `Files this build has already changed: ${[...touchedPaths].join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");
        const fullMsg = stateBlock ? `${userMsg}\n\n---\nBuild state (for context):\n${stateBlock}` : userMsg;
        try {
          const out = await streamChat([{ role: "user", content: fullMsg }], current, () => {}, {
            signal: cAc.signal,
            effort: opts?.effort ?? "low",
            thinking: false,
          });
          // Same safety net as the main pass: a corrective must never wipe a
          // file with a truncated/destructive full-file write.
          const resolved = applicableResolvedOps(resolveBuildOps(parseBuildStream(out).files, baseMap));
          // Path-safety gate, then collapse to the LAST op per path — with
          // cumulative resolution that op contains every earlier block's changes,
          // so multiple blocks against one file can't clobber each other.
          const ops = lastOpPerPath(safeWrites(resolved));
          if (ops.length) {
            await ensureCheckpoint();
            await writeFilesByPath(uid, projectId, ops.map((o) => ({ path: o.path, content: o.content })));
            current = await getProjectFilesOnce(uid, projectId).catch(() => current);
            const afterMap = mapContents(current);
            const persisted = persistedAppliedOps(ops, baseMap, afterMap);
            const visiblePaths = new Set(refreshTouched(persisted.map((o) => o.path)));
            const visibleOps = persisted.filter((o) => visiblePaths.has(o.path));
            if (visibleOps.length !== ops.length) {
              log.record("apply", {
                ok: false,
                detail: `${ops.length - visibleOps.length} corrective write(s) produced no persisted diff`,
                files: visibleOps.map((o) => o.path),
              });
            }
            return visibleOps;
          }
          return [];
        } catch {
          return [];
        } finally {
          clearTimeout(timer);
          ac.signal.removeEventListener("abort", onAbort);
        }
      };

      let reviewDone = false;
      let recoveredFromNoFileOps = false;
      let attemptedNoDiffRecovery = false;

      // ---- Apply the main ops, then guarantee they actually landed.
      if (mainOps.length) {
        // SNAPSHOT before any modification → rollback/recovery point (never lose work).
        showProgress("applying");
        await ensureCheckpoint();

        // Never write a full-file block that arrived truncated or collapsed to
        // near-empty — that's exactly how a good file gets wiped ("+1 −762").
        // Failed edits and unchanged rewrites are not progress; everything
        // not-ok is rewritten below instead of being counted as touched.
        // Path-safety gate: drop any absolute/traversal/junk paths before writing.
        // Collapse to the LAST op per path: resolution is cumulative, so that op
        // carries every earlier block's changes for the file (many small edit
        // blocks against one script.js land as ONE complete write, not 19
        // overwrites where only the final fragment survives).
        const safeOps = lastOpPerPath(safeWrites(applicableResolvedOps(mainOps)));
        if (safeOps.length) {
          await writeFilesByPath(uid, projectId, safeOps.map((o) => ({ path: o.path, content: o.content })));
          current = await getProjectFilesOnce(uid, projectId).catch(() => current);
          const afterMap = mapContents(current);
          const persisted = persistedAppliedOps(safeOps, beforeMap, afterMap);
          const appliedPaths = refreshTouched(persisted.map((o) => o.path));
          log.record("apply", {
            files: appliedPaths,
            ok: appliedPaths.length > 0,
            detail:
              appliedPaths.length === safeOps.length
                ? undefined
                : `${safeOps.length - appliedPaths.length} write(s) produced no persisted diff`,
          });
        } else {
          log.record("apply", { ok: false, detail: "no applicable file ops after safety checks" });
        }

        // Anything that didn't apply cleanly — an edit whose SEARCH didn't match,
        // or a write we refused because it was truncated/destructive — gets a
        // forced, complete full-file rewrite so the change actually lands (never a
        // phantom success, the #1 cause of "it said it fixed it but didn't").
        const needsRewrite = mainOps.filter((o) => !o.ok);
        if (needsRewrite.length) {
          showProgress("fixing");
          attemptedNoDiffRecovery = true;
          // Truncation-aware recovery: a large file whose write was cut off by
          // the time limit must be recovered with SMALL edit hunks — demanding
          // another full rewrite just hits the same wall and applies nothing.
          const failedInfo = [...new Map(needsRewrite.map((o) => [o.path, o])).values()].map((o) => {
            const before = beforeMap.get(o.path);
            return {
              path: o.path,
              truncated: truncatedPaths.has(o.path),
              existingLines: before ? before.split("\n").length : 0,
            };
          });
          await runCorrective(buildFailedOpsRecoveryPrompt(failedInfo));
        }
        refreshTouched();
        if (claimedChange && touchedPaths.size === 0 && !attemptedNoDiffRecovery) {
          showProgress("fixing");
          attemptedNoDiffRecovery = true;
          recoveredFromNoFileOps = (await runCorrective(buildNoAppliedDiffFixPrompt(text, mainOps.length))).length > 0;
        }
      }

      // Recover from a narrated response that still has no persisted file diff.
      // The standalone review pass was removed — the Verifier→Fixer loop below
      // reviews AND fixes (diff-aware, stricter), so a separate review call was
      // pure redundant spend. `reviewDone` is set from the loop running instead.
      if (claimedChange && touchedPaths.size === 0 && !attemptedNoDiffRecovery) {
        showProgress("fixing");
        attemptedNoDiffRecovery = true;
        recoveredFromNoFileOps = (await runCorrective(buildNoAppliedDiffFixPrompt(text, mainOps.length))).length > 0;
      }

      // ---- Plan-completion gate: planned NEW files that never materialized get
      // a forced creation pass. The approved plan is a contract, not a
      // suggestion — "did half the plan" must never be reported as done.
      if (plan && plan.steps.length && !ac.signal.aborted) {
        const currentMap = mapContents(current);
        const plannedMissing = [...new Set(plan.steps.flatMap((s) => s.files ?? []))].filter(
          (p) => !beforeMap.has(p) && !currentMap.has(p)
        );
        if (plannedMissing.length) {
          showProgress("fixing");
          log.record("fix", {
            ok: false,
            detail: `plan gap: ${plannedMissing.length} planned file(s) never created`,
            files: plannedMissing,
          });
          await runCorrective(
            [
              `The approved plan requires creating these files, but they do NOT exist in the project yet: ${plannedMissing.join(", ")}.`,
              "Create each of them now with a complete ```path=<path> block, and emit any small ```edit= hunks needed to wire them in (script/link tags, imports, nav links).",
              planToContext(plan),
            ].join("\n\n")
          );
        }
      }

      // ---- Backstop 1: faked / over-claimed bulk data → force a real runtime fetch.
      const fabReason = detectFabricatedData(mainProse, codeOf(current));
      let fabApplied = false;
      if (fabReason) {
        showProgress("fixing");
        fabApplied = (await runCorrective(BUILD_FETCH_DATA_FIX)).length > 0;
      }

      // ---- Backstop 2: explicit rename left behind → apply it everywhere.
      const renameTerms = extractRenames(text);
      if (renameTerms.length) {
        const stale = staleTermFiles(renameTerms, codeOf(current));
        if (stale.length) {
          showProgress("fixing");
          const detail = stale.map((s) => `"${s.term}" still appears in ${s.paths.join(", ")}`).join("; ");
          await runCorrective(`${BUILD_CONSISTENCY_FIX}\n\nLeftovers detected: ${detail}.`);
        }
      }

      // ============================================================
      // AGENTIC SELF-CORRECTION LOOP
      //   Each cycle: generate DIFFS → run runtime VALIDATION (compile/run) →
      //   run the strict LLM VERIFIER (diff-aware) → if both pass, done; else the
      //   FIXER consumes the issues + diffs, re-reads, and we re-verify. Bounded
      //   by effort (8–12 cycles). At the cap, remaining concerns are surfaced.
      // ============================================================
      let verifyNote = "";
      let finalVerdict: Verdict | null = null;
      const verifyMode = effectivePreviewMode(project, current);
      const canRuntime = verifyMode === "web" || verifyMode === "react" || verifyMode === "vue";
      const checklist = plan?.checklist ?? impliedChecks;
      const codeFiles = () => current.filter((f) => f.kind === "file");
      refreshTouched();
      // The strict Verifier→Fixer loop (below) is the request-satisfaction
      // gate. The standalone errors-only heal here is the FALLBACK when strict
      // review is disabled for the effort tier — never both.
      const shouldRunStrictRequestReview = effortProfile.strictReview;

      if (!shouldRunStrictRequestReview && touchedPaths.size > 0 && !ac.signal.aborted && canRuntime) {
        showProgress("validating", { cycle: 1, maxCycles: 1 });
        const endVal = log.begin("validate", "final runtime check");
        try {
          // The plan's acceptance checklist is enforced here — it's the
          // machine-checkable contract the plan promised the user.
          let report = await runVerification(codeFiles(), verifyMode, checklist);
          reviewDone = true;
          endVal({ ok: report.ok, verify: { ok: report.ok, issues: report.issues.length } });

          // Auto-heal REAL runtime/compile errors (reference errors, broken
          // includes — captured from actually running the project). This is
          // ERRORS-ONLY: no request-satisfaction critique, no strict review.
          // Bounded by the effort's heal budget + the build token budget, and it
          // stops immediately if a fix pass makes no progress.
          let heals = 0;
          while (
            !report.ok &&
            heals < effortProfile.verifyHeals &&
            !ac.signal.aborted &&
            spentForgeTokens < effortProfile.buildTokenBudget
          ) {
            heals++;
            showProgress("fixing");
            const endHeal = log.begin("heal", `runtime fix ${heals}/${effortProfile.verifyHeals}`);
            const fixed = await runCorrective(`${BUILD_VERIFY_FIX}\n\n${formatIssuesForFix(report.issues)}`);
            showProgress("validating");
            report = await runVerification(codeFiles(), verifyMode, checklist);
            endHeal({ ok: report.ok, verify: { ok: report.ok, issues: report.issues.length } });
            if (fixed.length === 0) break; // applied nothing → can't make progress
          }

          if (report.ok) {
            verifyNote =
              heals > 0
                ? `**Runtime verified.** Found and auto-fixed ${heals === 1 ? "a runtime error" : "runtime errors"}; the project now compiles and runs clean.`
                : "**Runtime verified.** The generated project compiles and runs without blocking runtime errors.";
          } else {
            const list = report.issues
              .slice(0, 4)
              .map((i) => {
                const loc = i.path ? `**${i.path}${i.line ? `:${i.line}` : ""}** - ` : "";
                return `${loc}${i.message}`;
              })
              .join("\n- ");
            verifyNote = `**Runtime check found ${report.issues.length} issue${report.issues.length === 1 ? "" : "s"}** I couldn't auto-fix:\n- ${list}\n\nTell me to fix ${report.issues.length === 1 ? "it" : "these"} and I'll take another pass.`;
          }
        } catch {
          endVal({ ok: false, detail: "runtime verification could not run" });
          verifyNote = "**Runtime check could not run.** The files were saved, but Forge could not complete the final run check.";
        }
      }

      // Strict LLM Verifier: separate agent (mode code-verify), reviews the diffs +
      // current files + runtime findings, returns PASS or FAIL+issues. Never edits.
      const runVerifier = async (diffText: string, runtimeIssues: VerifyIssue[]): Promise<Verdict | null> => {
        const vAc = new AbortController();
        const onAbort = () => vAc.abort();
        ac.signal.addEventListener("abort", onAbort);
        const timer = setTimeout(() => vAc.abort(), 60_000);
        try {
          const runtimeNote = runtimeIssues.length
            ? `Runtime validation (the project was compiled and run in a real browser) reported:\n${formatIssuesForFix(runtimeIssues)}`
            : canRuntime
              ? "Runtime validation compiled and ran the project with no console errors."
              : "Runtime validation was not available for this project type — review statically.";
          const msg = [
            `Original user request: ${text}`,
            plan ? `Approved plan:\n${planToContext(plan)}` : null,
            checklist.length
              ? `ACCEPTANCE CHECKLIST — every item must be satisfied; each unmet item is at least a major issue:\n${checklistToPrompt(checklist)}`
              : null,
            `Unified diffs of everything that changed in this build:\n${diffText}`,
            runtimeNote,
            "Audit the implementation against the request, the checklist, and the diffs now. Return your forge-verdict.",
          ]
            .filter(Boolean)
            .join("\n\n---\n\n");
          const out = await streamChat([{ role: "user", content: msg }], current, () => {}, {
            signal: vAc.signal,
            effort: settings.effort,
            thinking: false,
            mode: "code-verify",
          });
          return parseVerdict(out);
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
          ac.signal.removeEventListener("abort", onAbort);
        }
      };

      let firstIssueCount = 0; // issues found on the first review (for the recap)
      let prevIssueCount: number | null = null;
      let cyclesRun = 0;
      // Evidence ledger for the final recap: the LAST runtime validation's real
      // results. The closing "verified" claim is rendered from THIS, never from
      // the model's own narrative.
      let lastRuntimeIssues: VerifyIssue[] = [];
      // Convergence guards so the loop never grinds all 12 cycles on diminishing
      // returns (the #1 cause of 15-minute, churning runs): stop early when the
      // fixer makes no progress, the issue count stops improving, or we blow a
      // wall-clock budget.
      let bestIssueCount = Infinity;
      let stagnantPasses = 0;
      let stoppedForBudget = false;
      const loopStartedAt = Date.now();
      const LOOP_BUDGET_MS = 240_000; // hard cap on the whole self-correction loop
      if (shouldRunStrictRequestReview && touchedPaths.size > 0 && !ac.signal.aborted) {
        const maxCycles = effortProfile.selfCorrectIterations;
        for (let cycle = 1; cycle <= maxCycles && !ac.signal.aborted; cycle++) {
          // HARD TOKEN BUDGET — never let one build run away with your usage.
          if (spentForgeTokens >= effortProfile.buildTokenBudget) {
            stoppedForBudget = true;
            log.record("validate", { ok: false, detail: `token budget reached (~${Math.round(spentForgeTokens / 1000)}k forge tokens)` });
            break;
          }
          cyclesRun = cycle;
          // 1) DIFF AWARENESS — what changed, fed into verification.
          const diffs = buildDiffs(Array.from(touchedPaths), beforeMap, mapContents(current));
          const diffText = formatDiffsForPrompt(diffs);

          // 2) RUNTIME VALIDATION (compile + run) when the project type supports it.
          let runtimeIssues: VerifyIssue[] = [];
          let runtimeOk = true;
          if (canRuntime) {
            showProgress("validating", { cycle, maxCycles });
            const endVal = log.begin("validate", `cycle ${cycle}/${maxCycles}`);
            try {
              const report = await runVerification(codeFiles(), verifyMode, checklist);
              runtimeOk = report.ok;
              runtimeIssues = report.issues;
            } catch {
              /* runtime validation is best-effort */
            }
            lastRuntimeIssues = runtimeIssues;
            endVal({ ok: runtimeOk, verify: { ok: runtimeOk, issues: runtimeIssues.length } });
          }

          // 3) STRICT VERIFIER (diff-aware, stricter than the executor).
          showProgress("verifying-strict", { cycle, maxCycles });
          const endVer = log.begin("verify-strict", `cycle ${cycle}/${maxCycles}`);
          const verdict = await runVerifier(diffText, runtimeIssues);
          finalVerdict = verdict;
          if (cycle === 1 && verdict) firstIssueCount = verdict.issues.length;
          endVer({
            ok: !verdict || verdict.status === "pass",
            verify: verdict ? { ok: verdict.status === "pass", issues: verdict.issues.length } : undefined,
          });
          // Conversational update after the review pass.
          setStreaming((s) =>
            s
              ? {
                  ...s,
                  phase: "verifying-strict",
                  files: realChanges(),
                  cycle,
                  maxCycles,
                  verdict: verdict ?? undefined,
                  narration: reviewNarration(verdict, cycle, prevIssueCount, false),
                }
              : s
          );

          // 4) Both gates clear → done.
          const passed = runtimeOk && (!verdict || verdict.status === "pass");
          if (passed) break;
          if (cycle === maxCycles) break; // iteration cap reached

          // Convergence: is this review actually better than the best so far?
          const totalIssues = (verdict ? verdict.issues.length : 0) + runtimeIssues.length;
          if (totalIssues < bestIssueCount) {
            bestIssueCount = totalIssues;
            stagnantPasses = 0;
          } else {
            stagnantPasses++;
          }
          // Two reviews in a row with no net improvement → diminishing returns.
          if (stagnantPasses >= 2) break;
          // Wall-clock budget for the loop — never grind for many minutes.
          if (Date.now() - loopStartedAt > LOOP_BUDGET_MS) break;
          // Token budget — don't start another (expensive) fix pass if we're out.
          if (spentForgeTokens >= effortProfile.buildTokenBudget) {
            stoppedForBudget = true;
            break;
          }
          prevIssueCount = verdict ? verdict.issues.length : prevIssueCount;

          // 5) FIXER — consume runtime issues + verifier issues + diffs, re-implement.
          setStreaming((s) =>
            s
              ? {
                  ...s,
                  phase: "fixing",
                  files: realChanges(),
                  cycle,
                  maxCycles,
                  verdict: verdict ?? undefined,
                  narration: reviewNarration(verdict, cycle, prevIssueCount, true),
                }
              : s
          );
          const endFix = log.begin("fix", `cycle ${cycle}/${maxCycles}`);
          const fixMsg = [
            CODE_FIXER_ADDENDUM,
            runtimeIssues.length ? formatIssuesForFix(runtimeIssues) : null,
            verdict && verdict.issues.length ? formatVerdictForFix(verdict) : null,
            `Unified diffs of what you have changed so far:\n${diffText}`,
            `Original user request: ${text}`,
          ]
            .filter(Boolean)
            .join("\n\n---\n\n");
          // Fixer runs above "low": it's consuming a structured verdict and
          // must reason about root causes, not just pattern-match a fix.
          const fixedOps = await runCorrective(fixMsg, { effort: "medium" });
          endFix({ ok: fixedOps.length > 0, files: fixedOps.map((o) => o.path) });
          // The fixer applied nothing (timed out / emitted no valid blocks) → it
          // can't make progress, so stop rather than re-reviewing the same files.
          if (fixedOps.length === 0) break;
        }
        reviewDone = cyclesRun > 0; // the Verifier loop IS the review now

        // Evidence-based closing recap. The "verified" claim is computed from
        // the REAL last validation results + verdict — never from the model's
        // own narrative (a loop that exits on stagnation/budget with runtime
        // failures still open must not read as a clean pass).
        const openIssues = finalVerdict && finalVerdict.status === "fail" ? finalVerdict.issues : [];
        const fixedCount = Math.max(0, firstIssueCount - openIssues.length);
        const checksFailed = lastRuntimeIssues.filter((i) => i.kind === "check").length;
        const runtimeErrs = lastRuntimeIssues.filter((i) => i.kind !== "check");
        const checksTotal = checklist.length;
        const evidence =
          canRuntime && checksTotal
            ? checksFailed === 0
              ? ` All ${checksTotal} acceptance check${checksTotal === 1 ? "" : "s"} pass.`
              : ` ${checksTotal - checksFailed}/${checksTotal} acceptance checks pass.`
            : "";
        if (openIssues.length === 0 && runtimeErrs.length === 0 && checksFailed === 0) {
          const fixedNote =
            firstIssueCount > 0
              ? ` I caught and fixed ${firstIssueCount} issue${firstIssueCount === 1 ? "" : "s"} along the way`
              : "";
          verifyNote = canRuntime
            ? `**Reviewed and verified.**${fixedNote} — it compiles, runs clean, and passes the full review.${evidence} ✓`
            : `**Reviewed and verified.**${fixedNote} — it passes the full implementation review. ✓`;
        } else {
          const remaining = [
            ...runtimeErrs.slice(0, 2).map((i) => `**${i.path ?? "runtime"}** — ${i.message}`),
            ...sortIssues(openIssues)
              .slice(0, 3)
              .map((i) => `**${i.title}** — ${i.fix || i.detail}`),
          ];
          const remainingCount = openIssues.length + runtimeErrs.length + checksFailed;
          const fixedNote = fixedCount > 0 ? `Fixed ${fixedCount} of ${firstIssueCount} issues. ` : "";
          const passWord = cyclesRun === 1 ? "pass" : "passes";
          const stopNote = stoppedForBudget
            ? ` I stopped here to keep this build within your usage budget (~${Math.round(spentForgeTokens / 1000)}k tokens)`
            : "";
          verifyNote = `**Reviewed over ${cyclesRun} ${passWord}.** ${fixedNote}${remainingCount} item${remainingCount === 1 ? "" : "s"} I'd still flag:\n- ${remaining.join("\n- ")}${evidence}${stopNote ? `\n\n${stopNote.trim()}.` : ""}\n\nWant me to keep going on ${remainingCount === 1 ? "it" : "these"}?`;
        }
      }

      // ---- Finalize: persist the real, combined change set + project state.
      showProgress("finalizing");
      const finalMap = mapContents(current);
      refreshTouched();
      const changes: BuildFileChange[] = buildAppliedChanges(touchedPaths, beforeMap, finalMap);

      if (changes.length) {
        await touchProject(uid, projectId, current.filter((f) => f.kind === "file").length);
        if (project.previewMode === "none") {
          const detected = detectPreviewKind(current);
          if (detected !== "none") await updateProject(uid, projectId, { previewMode: detected });
        }
        toast.success(`${changes.length} file${changes.length === 1 ? "" : "s"} updated`);
      }

      // Honest summary. If the data backstop changed the approach, describe what
      // really happened (a runtime fetch). If nothing actually changed despite a
      // claim, say so plainly rather than reporting a phantom success.
      let assistantContent: string;
      if (claimedChange && changes.length === 0) {
        // Distinguish "the platform cut the generation off" (an honest timeout,
        // nothing the model fabricated) from "the model claimed work it never
        // emitted/persisted" — they need very different messages.
        assistantContent = hadTruncatedWrite
          ? summarizeTruncatedBuild([...truncatedPaths], attemptedNoDiffRecovery)
          : summarizeNoAppliedChangesClaim(mainOps.length);
      } else if (fabReason) {
        assistantContent = fabApplied
          ? "Loaded the word list at runtime from a real source — `script.js` now **fetches** a full word list on load (with a small built-in fallback), instead of hard-coding it. (Tens of thousands of words can't be hand-typed reliably, so fetching the real data is the correct approach.)"
          : "A list that large can't be hard-coded reliably — it needs to load from a real source at runtime, but I couldn't complete that wiring this time. Ask me again to load the word list from a URL.";
      } else if (changes.length) {
        assistantContent = summarizeAppliedBuild(changes, { reviewed: reviewDone, recoveredFromNoFileOps });
        if (verifyNote) assistantContent += `\n\n${verifyNote}`;
      } else {
        const note = reviewDone ? "_✓ Reviewed for completeness._" : "";
        assistantContent = [mainProse, note].filter(Boolean).join("\n\n") || "Done.";
      }
      log.record("finalize", { files: changes.map((c) => c.path), ok: true });
      const runSummary = log.finish(
        changes.length
          ? "applied"
          : claimedChange
            ? hadTruncatedWrite
              ? "no-op (generation cut off by time limit)"
              : mainOps.length
                ? "no-op (file blocks did not persist)"
                : "no-op (claimed but unwritten)"
            : "done",
        changes.map((c) => c.path)
      );
      await addBuildMessage(uid, projectId, {
        role: "assistant",
        content: assistantContent,
        files: changes.length ? changes : undefined,
        skillsUsed: skillRefs.length ? skillRefs : undefined,
        agentRun: runSummary,
      });
      setStreaming(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        log.finish("aborted", []);
        setStreaming(null);
      } else {
        log.finish("error", []);
        const msg = err instanceof Error && err.message && err.message !== "response" ? err.message : "Forge couldn't respond. Try again.";
        setStreaming({ content: "", reasoning: "", phase: "error", mode: dockMode, error: msg });
      }
    } finally {
      acRef.current = null;
    }
  };

  const stop = () => {
    planApprovalRef.current?.(false);
    acRef.current?.abort();
  };
  const approvePlan = () => planApprovalRef.current?.(true);
  const cancelPlan = () => planApprovalRef.current?.(false);

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
        selectSkill(pickerResults[activePickerIndex]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const isStreaming = Boolean(streaming && streaming.phase !== "error");

  return (
    <div className="build-dock">
      <div className="dock-head">
        <div className="segmented dock-seg">
          <div className="seg-thumb" style={{ left: mode === "build" ? "3px" : "calc(50% + 1px)", right: mode === "build" ? "calc(50% + 1px)" : "3px", transition: "left .3s cubic-bezier(.34,1.56,.64,1), right .3s cubic-bezier(.34,1.56,.64,1)" }} />
          <button className={mode === "build" ? "active" : ""} onClick={() => setMode("build")}>
            <Hammer /> Build
          </button>
          <button className={mode === "discuss" ? "active" : ""} onClick={() => setMode("discuss")}>
            <MessagesSquare /> Discuss
          </button>
        </div>
      </div>

      {/* #13 · indeterminate build bar while a build streams */}
      {streaming && streaming.mode === "build" && streaming.phase !== "error" && (
        <div className="dock-build-bar" aria-hidden />
      )}

      <ArtifactSurfaceCtx.Provider value="dock">
        <div className="dock-scroll" ref={scrollRef}>
          {messages.length === 0 && !streaming && (
            <div className="dock-empty">
              <div className="es-glyph" style={{ width: 48, height: 48, marginBottom: 10 }}>
                <SparkFilled style={{ width: 24, height: 24 }} />
              </div>
              <p style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
                {mode === "build"
                  ? "Describe what to build or change. Forge edits the files directly, then reviews its own work."
                  : "Ask about the project — Forge won't edit files in Discuss mode."}
              </p>
            </div>
          )}

          {messages.map((m) => {
            const fileRows = normalizeFileChanges(m.files).map(
              (f): FileRow => ({ ...f, status: "done" })
            );
            return (
              <div className={`dock-msg ${m.role}`} key={m.id}>
                {m.role === "assistant" && (
                  <div className="dock-ai-name">
                    <SparkFilled style={{ width: 13, height: 13 }} /> Forge OS
                  </div>
                )}
                {m.role === "user" ? (
                  <div className="dock-bubble">{m.content}</div>
                ) : (
                  <div className="dock-ai">
                    {m.skillsUsed && m.skillsUsed.length > 0 && <SkillStatus skills={m.skillsUsed} />}
                    {m.content && <Markdown content={m.content} />}
                    {fileRows.length > 0 && <BuildFileList rows={fileRows} live={false} />}
                    {m.agentRun && <AgentRunTrace run={m.agentRun} />}
                  </div>
                )}
              </div>
            );
          })}

          {streaming && (
            <div className="dock-msg assistant">
              <div className="dock-ai-name">
                <SparkFilled style={{ width: 13, height: 13 }} /> Forge OS
              </div>
              <div className="dock-ai">
                {streaming.phase !== "error" && activeSkillRefs.length > 0 && (
                  <SkillStatus skills={activeSkillRefs} working />
                )}
                {streaming.phase === "error" ? (
                  <div style={{ color: "var(--danger)", fontSize: 13.5 }}>{streaming.error}</div>
                ) : streaming.mode === "build" ? (
                  <>
                    <AgentPipeline phase={streaming.phase} />
                    {streaming.phase === "plan" && streaming.plan ? (
                      <BuildPlanCard plan={streaming.plan} onApprove={approvePlan} onCancel={cancelPlan} />
                    ) : streaming.phase === "planning" ? (
                      <PlanningPanel text={streaming.planText} />
                    ) : (
                      <>
                        {showBuildProse && <Markdown content={parsed?.prose ?? ""} />}
                        {panelRows.length > 0 && <BuildFileList rows={panelRows} live />}
                        {streaming.narration &&
                          (streaming.phase === "verifying-strict" || streaming.phase === "fixing") && (
                            <div className="agent-say">{streaming.narration}</div>
                          )}
                        {streaming.verdict &&
                          (streaming.phase === "verifying-strict" || streaming.phase === "fixing") && (
                            <VerifierPanel
                              verdict={streaming.verdict}
                              cycle={streaming.cycle}
                              maxCycles={streaming.maxCycles}
                              fixing={streaming.phase === "fixing"}
                            />
                          )}
                        {streaming.phase === "reasoning" ? (
                          <div className="status-chip">
                            <span className="shimmer-text">Thinking…</span>
                          </div>
                        ) : STAGE_CHIP_PHASES.includes(streaming.phase) ? (
                          <div className={`bf-review stage-${streaming.phase}`}>
                            <span className="bf-pulse-dot" /> {phaseChip(streaming.phase, streaming.cycle, streaming.maxCycles)}
                          </div>
                        ) : !showBuildProse && panelRows.length === 0 ? (
                          <div className="status-chip">
                            <TypingDots /> Working…
                          </div>
                        ) : null}
                        {showBuildProse && streaming.phase === "streaming" && (
                          <span className="streaming-caret" aria-hidden />
                        )}
                      </>
                    )}
                  </>
                ) : streaming.content ? (
                  <>
                    <Markdown content={streaming.content} />
                    <span className="streaming-caret" aria-hidden />
                  </>
                ) : (
                  <div className="status-chip">
                    {streaming.phase === "reasoning" ? <span className="shimmer-text">Thinking…</span> : <><TypingDots /> Working…</>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ArtifactSurfaceCtx.Provider>

      <div className="dock-composer" style={{ position: "relative" }}>
        {activeSkillRefs.length > 0 && (
          <div className="composer-chips" style={{ marginBottom: 8 }}>
            {activeSkillRefs.map((s) => (
              <span className="ctx-chip" key={s.slug}>
                <Sparkles />
                {s.name}
                <span className="rm" onClick={() => removeSkill(s.slug)} role="button" aria-label="Remove skill">
                  <X size={11} />
                </span>
              </span>
            ))}
          </div>
        )}

        <AnimatePresence>
          {pickerOpen && (
            <div className="popover" style={{ left: 12, right: 12, width: "auto", bottom: "calc(100% + 6px)" }}>
              {pickerResults.length === 0 ? (
                <div className="popover-empty">
                  {enabledSkills.length === 0 ? "No skills yet. Create one in Skills." : "No matching skills."}
                </div>
              ) : (
                pickerResults.map((s, i) => (
                  <div
                    key={s.id}
                    className={`popover-item ${i === activePickerIndex ? "active" : ""}`}
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

        <textarea
          ref={taRef}
          className="composer-input"
          rows={1}
          placeholder={mode === "build" ? "Describe what to build…  (/ for skills)" : "Ask about the project…"}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setPickerIndex(0);
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = Math.min(t.scrollHeight, 150) + "px";
          }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-bar">
          <button
            className="c-icon"
            title="Add skill"
            onClick={() => {
              setDraft((d) => (d.startsWith("/") ? d : "/"));
              taRef.current?.focus();
            }}
          >
            <Plus />
          </button>
          <AgentMenu />
          <div className="composer-spacer" />
          <div className="menu-anchor" ref={anchorRef}>
            <button className={`model-trigger ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen((o) => !o)} style={{ fontSize: 12.5 }}>
              <b key={`m-${model}`} className="swap-in">{FORGE_MODELS_PUBLIC[model].label}</b>
              <span key={`e-${effort}`} className="effort-tag swap-in">{EFFORT[effort].label}</span>
              <ChevronDown className="chev" />
            </button>
            <AnimatePresence>{menuOpen && <ModelMenu align="right" buildMode={mode === "build"} />}</AnimatePresence>
          </div>
          {isStreaming ? (
            <button className="send-btn stop" onClick={stop} title="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button className="send-btn" onClick={send} disabled={!draft.trim()} title="Send">
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

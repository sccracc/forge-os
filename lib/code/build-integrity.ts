import type { ForgeModelId } from "@/lib/ai/models.public";

export interface AppliedBuildChange {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
}

export type BuildExecutionMode = "build" | "discuss";

export const RELIABLE_BUILD_MODEL: ForgeModelId = "magnum-2.8";

const CHANGE_CLAIM_RE =
  /\b(updat(?:e|ed|ing)?|chang(?:e|ed|ing)?|renam(?:e|ed|ing)?|add(?:ed|ing)?|creat(?:e|ed|ing)?|replac(?:e|ed|ing)?|wrote|written|rebuil(?:d|t|ding)?|built|fix(?:ed|ing)?|adjust(?:ed|ing)?|remov(?:e|ed|ing)?|delet(?:e|ed|ing)?|implement(?:ed|ing)?|styl(?:e|ed|ing)?)\b/i;

export function modelForBuildExecution(
  selectedModel: ForgeModelId,
  mode: BuildExecutionMode
): ForgeModelId {
  return mode === "build" ? RELIABLE_BUILD_MODEL : selectedModel;
}

export function claimsBuildChange(prose: string): boolean {
  return CHANGE_CLAIM_RE.test(prose);
}

export function buildNoFileOpsFixPrompt(userRequest: string): string {
  return buildNoAppliedDiffFixPrompt(userRequest, 0);
}

export function buildNoAppliedDiffFixPrompt(userRequest: string, fileBlockCount: number): string {
  const observed =
    fileBlockCount > 0
      ? `The previous response emitted ${fileBlockCount} file block${fileBlockCount === 1 ? "" : "s"}, but none produced a persisted project diff. The blocks were invalid, unchanged, unsafe, failed to apply, or were not saved.`
      : "The previous response claimed project files were changed, but it emitted zero file-write blocks, so nothing was written.";
  return [
    observed,
    "Perform the user's request now. Emit real fenced file blocks only: use ```path=<path> for full files or ```edit=<path> with SEARCH text copied exactly from the current project files.",
    "Plain fenced code blocks such as ```js, ```html, or ```css are ignored and save nowhere.",
    "Do not summarize, review, or claim completion unless you emit the matching file blocks in this response.",
    `User's request: ${userRequest}`,
  ].join("\n\n");
}

export function summarizeAppliedBuild(
  changes: AppliedBuildChange[],
  opts: { reviewed?: boolean; recoveredFromNoFileOps?: boolean } = {}
): string {
  const count = changes.length;
  const fileWord = count === 1 ? "file" : "files";
  const lead =
    count > 0
      ? `Applied the requested changes to ${count} ${fileWord}.`
      : "No files changed.";
  const recovery = opts.recoveredFromNoFileOps
    ? " The first response emitted no file-write blocks, so Forge forced a real file-write pass before reporting success."
    : "";
  const proof =
    count > 0 ? " The file list below is the source of truth for what changed." : "";
  const review = opts.reviewed ? "\n\n_Checked the result for completeness._" : "";

  return `${lead}${recovery}${proof}${review}`;
}

// ---- Failed-op recovery (truncation-aware) ----------------------------------
//
// When a file block fails to apply, the recovery pass must NOT blindly demand a
// full-file rewrite: if the block failed because the generation hit the time
// limit mid-file (a giant rewrite), re-requesting the whole file just hits the
// same wall, burns the tokens again, and applies nothing. Large existing files
// are recovered with targeted edit hunks (small, fast, always land); only
// small or brand-new files get a full re-emit.

export interface FailedOpRecoveryInfo {
  path: string;
  /** The stream was cut off mid-block (closing fence never arrived). */
  truncated: boolean;
  /** Line count of the file as it exists in the project right now (0 = new). */
  existingLines: number;
}

/** At/above this size, recovery must use edit hunks — never a full re-emit. */
export const RECOVERY_EDIT_THRESHOLD_LINES = 250;

export function buildFailedOpsRecoveryPrompt(failed: FailedOpRecoveryInfo[]): string {
  const editPaths = [
    ...new Set(failed.filter((f) => f.existingLines >= RECOVERY_EDIT_THRESHOLD_LINES).map((f) => f.path)),
  ];
  const rewritePaths = [
    ...new Set(failed.filter((f) => f.existingLines < RECOVERY_EDIT_THRESHOLD_LINES).map((f) => f.path)),
  ];
  const cause = failed.some((f) => f.truncated)
    ? "Your previous output was CUT OFF by the generation time limit before it finished, so those file blocks were discarded — the project files are UNCHANGED from before your attempt."
    : "Your previous file blocks did not apply (mismatched SEARCH text, or an incomplete/empty write) — the project files are UNCHANGED.";
  const parts = [cause];
  if (editPaths.length) {
    parts.push(
      `Re-apply your intended changes to ${editPaths.join(", ")} as MANY SMALL \`\`\`edit=<path> hunks, with each SEARCH copied EXACTLY from the current Project files context. These files are LARGE: do NOT re-emit any of them in full — a full re-emit will be cut off again and discarded. Small hunks stream fast and always land.`
    );
  }
  if (rewritePaths.length) {
    parts.push(
      `For ${rewritePaths.join(", ")} (small or new), emit the COMPLETE corrected contents as a \`\`\`path=<path> block — whole and self-contained, no truncation.`
    );
  }
  parts.push(
    "Cover every change you intended to make. Emit only file blocks plus at most one short sentence; do not claim completion without the matching blocks."
  );
  return parts.join("\n\n");
}

/** Honest final message when the generation time limit ate the build. The model
 *  didn't fabricate anything — the platform cut it off — so say that, confirm
 *  no work was lost, and steer the user to a request that will fit. */
export function summarizeTruncatedBuild(paths: string[], attemptedRecovery: boolean): string {
  const list = paths.slice(0, 3).join(", ") || "a project file";
  const parts = [
    `That build was too big for one pass: generation hit the time limit while writing ${list}, so the output arrived incomplete. I discarded the partial output to protect your working code — **nothing in your project was changed or lost**.`,
  ];
  if (attemptedRecovery) {
    parts.push("I attempted a targeted-edit recovery, but it couldn't complete in this pass either.");
  }
  parts.push(
    "Send the request again in smaller pieces — one or two features at a time — and I'll land each one."
  );
  return parts.join("\n\n");
}

export function summarizeNoFileOpsClaim(): string {
  return summarizeNoAppliedChangesClaim(0);
}

export function summarizeNoAppliedChangesClaim(fileBlockCount: number): string {
  const detail =
    fileBlockCount > 0
      ? "it emitted file blocks, but none produced a saved file change."
      : "it described project changes but emitted no file-write blocks, so nothing was saved.";
  return [
    `I caught an invalid build response: ${detail}`,
    "I did not keep the fabricated summary as the result.",
  ].join("\n\n");
}

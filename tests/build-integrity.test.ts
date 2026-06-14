import { describe, expect, it } from "vitest";
import {
  buildNoFileOpsFixPrompt,
  buildNoAppliedDiffFixPrompt,
  claimsBuildChange,
  modelForBuildExecution,
  RELIABLE_BUILD_MODEL,
  summarizeAppliedBuild,
  summarizeNoAppliedChangesClaim,
  summarizeNoFileOpsClaim,
} from "@/lib/code/build-integrity";

describe("build integrity", () => {
  it("uses the reliable model for file-writing build passes", () => {
    expect(RELIABLE_BUILD_MODEL).toBe("magnum-2.8");
    expect(modelForBuildExecution("spark-2.5", "build")).toBe("magnum-2.8");
    expect(modelForBuildExecution("spark-2.5", "discuss")).toBe("spark-2.5");
  });

  it("detects prose that claims project changes", () => {
    expect(claimsBuildChange("The complete website has been rebuilt with polished animations.")).toBe(
      true
    );
    expect(claimsBuildChange("I can do that once you tell me which page to target.")).toBe(false);
  });

  it("forces a real file-write pass after a no-op change claim", () => {
    const prompt = buildNoFileOpsFixPrompt("make it more polished");

    expect(prompt).toContain("emitted zero file-write blocks");
    expect(prompt).toContain("```path=<path>");
    expect(prompt).toContain("```edit=<path>");
    expect(prompt).toContain("make it more polished");
  });

  it("forces a real file-write pass after emitted blocks produce no saved diff", () => {
    const prompt = buildNoAppliedDiffFixPrompt("fix the game", 3);

    expect(prompt).toContain("3 file blocks");
    expect(prompt).toContain("none produced a persisted project diff");
    expect(prompt).toContain("Plain fenced code blocks");
    expect(prompt).toContain("fix the game");
  });

  it("summarizes successful builds from actual applied diffs", () => {
    const summary = summarizeAppliedBuild(
      [{ path: "index.html", added: 12, removed: 3, isNew: false }],
      { reviewed: true, recoveredFromNoFileOps: true }
    );

    expect(summary).toContain("Applied the requested changes to 1 file.");
    expect(summary).toContain("forced a real file-write pass");
    expect(summary).toContain("source of truth");
    expect(summary).toContain("Checked the result");
  });

  it("does not preserve fabricated no-op summaries", () => {
    const summary = summarizeNoFileOpsClaim();

    expect(summary).toContain("nothing was saved");
    expect(summary).toContain("did not keep the fabricated summary");
    expect(summary).not.toContain("rebuilt");
  });

  it("explains invalid emitted blocks differently from missing blocks", () => {
    const summary = summarizeNoAppliedChangesClaim(2);

    expect(summary).toContain("emitted file blocks");
    expect(summary).toContain("none produced a saved file change");
    expect(summary).toContain("did not keep the fabricated summary");
  });
});

describe("truncation-aware recovery", () => {
  const big = (path: string, truncated = true) => ({ path, truncated, existingLines: 1900 });
  const small = (path: string) => ({ path, truncated: false, existingLines: 40 });
  const fresh = (path: string) => ({ path, truncated: true, existingLines: 0 });

  it("demands SMALL edit hunks (never a full re-emit) for a large truncated file", async () => {
    const { buildFailedOpsRecoveryPrompt } = await import("@/lib/code/build-integrity");
    const p = buildFailedOpsRecoveryPrompt([big("index.html")]);
    expect(p).toContain("CUT OFF by the generation time limit");
    expect(p).toContain("edit=");
    expect(p).toMatch(/do NOT re-emit/i);
    expect(p).toContain("index.html");
    // Must not instruct a full-file rewrite for the large file.
    expect(p).not.toMatch(/full-file rewrite, NOT an edit block/i);
  });

  it("still allows full rewrites for small or brand-new files", async () => {
    const { buildFailedOpsRecoveryPrompt } = await import("@/lib/code/build-integrity");
    const p = buildFailedOpsRecoveryPrompt([small("style.css"), fresh("js/new.js")]);
    expect(p).toContain("path=");
    expect(p).toContain("style.css");
    expect(p).toContain("js/new.js");
  });

  it("routes mixed failures to the right strategy per file", async () => {
    const { buildFailedOpsRecoveryPrompt, RECOVERY_EDIT_THRESHOLD_LINES } = await import(
      "@/lib/code/build-integrity"
    );
    expect(RECOVERY_EDIT_THRESHOLD_LINES).toBeGreaterThan(0);
    const p = buildFailedOpsRecoveryPrompt([big("index.html"), small("style.css")]);
    const paragraphs = p.split("\n\n");
    const editPara = paragraphs.find((s) => s.includes("edit=<path>"))!;
    const rewritePara = paragraphs.find((s) => s.includes("path=<path>"))!;
    expect(editPara).toContain("index.html");
    expect(editPara).not.toContain("style.css");
    expect(rewritePara).toContain("style.css");
    expect(rewritePara).not.toContain("index.html");
  });
});

describe("summarizeTruncatedBuild", () => {
  it("explains the time limit honestly and confirms nothing was lost", async () => {
    const { summarizeTruncatedBuild } = await import("@/lib/code/build-integrity");
    const s = summarizeTruncatedBuild(["index.html"], true);
    expect(s).toContain("time limit");
    expect(s).toContain("index.html");
    expect(s).toMatch(/nothing in your project was changed or lost/i);
    expect(s).toContain("smaller pieces");
    // Never accuse the model of fabricating when the platform cut it off.
    expect(s).not.toMatch(/fabricat|invalid build response/i);
  });

  it("omits the recovery line when no recovery was attempted", async () => {
    const { summarizeTruncatedBuild } = await import("@/lib/code/build-integrity");
    expect(summarizeTruncatedBuild(["a.js"], false)).not.toContain("targeted-edit recovery");
  });
});

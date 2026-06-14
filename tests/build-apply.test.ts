import { describe, expect, it } from "vitest";
import {
  applicableResolvedOps,
  buildAppliedChanges,
  persistedAppliedOps,
  refreshTouchedPaths,
} from "@/lib/code/build-apply";
import { parseBuildStream, resolveBuildOps } from "@/lib/code/build-stream";

const pathBlock = (path: string, body: string) => `\`\`\`path=${path}\n${body}\n\`\`\``;
const editBlock = (path: string, search: string, replace: string) =>
  `\`\`\`edit=${path}\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\``;

describe("build apply integrity", () => {
  it("does not consider failed edit hunks applicable", () => {
    const existing = new Map([["app.js", "const name = 'Forge';"]]);
    const ops = resolveBuildOps(parseBuildStream(editBlock("app.js", "missing", "changed")).files, existing);

    expect(ops[0].ok).toBe(false);
    expect(applicableResolvedOps(ops)).toEqual([]);
  });

  it("does not write already-identical full-file blocks", () => {
    const existing = new Map([["index.html", "<h1>Same</h1>"]]);
    const ops = resolveBuildOps(parseBuildStream(pathBlock("index.html", "<h1>Same</h1>")).files, existing);

    expect(ops[0].ok).toBe(true);
    expect(applicableResolvedOps(ops)).toEqual([]);
  });

  it("requires a write to be persisted with the intended content", () => {
    const beforeWrite = new Map([["app.js", "old"]]);
    const ops = resolveBuildOps(parseBuildStream(pathBlock("app.js", "new")).files, beforeWrite);

    expect(persistedAppliedOps(ops, beforeWrite, new Map([["app.js", "old"]]))).toEqual([]);
    expect(persistedAppliedOps(ops, beforeWrite, new Map([["app.js", "different"]]))).toEqual([]);
    expect(persistedAppliedOps(ops, beforeWrite, new Map([["app.js", "new"]]))).toHaveLength(1);
  });

  it("keeps touched paths limited to files that still differ from the build snapshot", () => {
    const touched = new Set<string>(["app.js"]);
    const beforeBuild = new Map([
      ["app.js", "old"],
      ["style.css", "a{}"],
    ]);
    const afterBuild = new Map([
      ["app.js", "old"],
      ["style.css", "b{}"],
    ]);

    const newlyVisible = refreshTouchedPaths(touched, ["style.css"], beforeBuild, afterBuild);

    expect(newlyVisible).toEqual(["style.css"]);
    expect(Array.from(touched)).toEqual(["style.css"]);
    expect(buildAppliedChanges(touched, beforeBuild, afterBuild)).toEqual([
      { path: "style.css", added: 1, removed: 1, isNew: false },
    ]);
  });
});

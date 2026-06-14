import { describe, it, expect } from "vitest";
import { parseVerdict, formatVerdictForFix, sortIssues } from "@/lib/code/verdict";

const fence = (json: unknown) => "```forge-verdict\n" + JSON.stringify(json) + "\n```";

describe("verdict — parseVerdict", () => {
  it("parses a clean PASS with no issues", () => {
    const v = parseVerdict(fence({ status: "pass", summary: "looks good", issues: [] }));
    expect(v).toBeTruthy();
    expect(v!.status).toBe("pass");
    expect(v!.issues).toHaveLength(0);
  });

  it("parses a FAIL with normalized severity + category", () => {
    const v = parseVerdict(
      fence({
        status: "fail",
        summary: "missing wiring",
        issues: [
          { severity: "critical", category: "missing-import", title: "no import", detail: "x", fix: "add import" },
          { severity: "weird", category: "nonsense", title: "loose", detail: "y", fix: "z" },
        ],
      })
    );
    expect(v!.status).toBe("fail");
    expect(v!.issues[0].severity).toBe("critical");
    expect(v!.issues[1].severity).toBe("major"); // normalized fallback
    expect(v!.issues[1].category).toBe("other"); // normalized fallback
  });

  it("forces FAIL when issues exist even if the model claimed pass", () => {
    const v = parseVerdict(
      fence({ status: "pass", summary: "", issues: [{ severity: "major", category: "broken-logic", title: "bug", detail: "", fix: "" }] })
    );
    expect(v!.status).toBe("fail");
  });

  it("returns null when no verdict block is present", () => {
    expect(parseVerdict("just some prose, no block")).toBeNull();
  });

  it("drops issues without a title", () => {
    const v = parseVerdict(fence({ status: "fail", issues: [{ severity: "minor", title: "", detail: "x", fix: "y" }] }));
    expect(v!.issues).toHaveLength(0);
    expect(v!.status).toBe("pass"); // no real issues left
  });
});

describe("verdict — sorting + fix brief", () => {
  it("sorts critical before major before minor", () => {
    const issues = [
      { severity: "minor" as const, category: "other" as const, title: "c", detail: "", fix: "" },
      { severity: "critical" as const, category: "other" as const, title: "a", detail: "", fix: "" },
      { severity: "major" as const, category: "other" as const, title: "b", detail: "", fix: "" },
    ];
    expect(sortIssues(issues).map((i) => i.title)).toEqual(["a", "b", "c"]);
  });

  it("formats a fix brief that includes each issue's fix instruction", () => {
    const brief = formatVerdictForFix({
      status: "fail",
      summary: "",
      issues: [{ severity: "critical", category: "security", title: "xss", detail: "unsafe html", fix: "escape it", file: "x.js" }],
    });
    expect(brief).toContain("[x.js]");
    expect(brief).toContain("escape it");
    expect(brief).toContain("security");
  });
});

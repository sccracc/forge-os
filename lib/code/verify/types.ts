// Shared verification types (kept in one place to avoid import cycles).

export interface ProbeError {
  message: string;
  source?: string;
  line?: number;
  col?: number;
}

export interface DomSummary {
  title: string;
  headings: string[];
  counts: Record<string, number>;
  bodyTextLen: number;
}

export interface SmokeResult {
  id: string;
  label: string;
  ok: boolean;
  error?: string;
}

export interface VerifyIssue {
  kind: "compile" | "runtime" | "ref" | "check";
  path?: string;
  message: string;
  line?: number;
}

export type VerifyMode = "web" | "react" | "vue";

export interface VerificationReport {
  ok: boolean;
  issues: VerifyIssue[];
  dom: DomSummary | null;
}

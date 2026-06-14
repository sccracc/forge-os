"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { AlertCircle, CheckCircle2, Info, Play } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { runnableCodeLanguage, scriptNeedsInput } from "@/lib/code/run-utils";

export interface CodeRunResult {
  stdout: string;
  stderr: string;
  error: string | null;
  available: boolean;
  inputRequired?: boolean;
}

export function useCodeRunner(code: string, lang: string) {
  const { getIdToken } = useAuth();
  const language = runnableCodeLanguage(lang);
  const needsInput = Boolean(language && scriptNeedsInput(code, language));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CodeRunResult | null>(null);
  const [stdin, setStdin] = useState("");

  const run = useCallback(async () => {
    if (!language || running) return;
    setRunning(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Your session expired. Please sign in again.");
      const res = await fetch("/api/code/run", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ code, language, stdin: stdin.length ? stdin : undefined }),
      });
      const json = (await res.json().catch(() => null)) as Partial<CodeRunResult> | null;
      if (!res.ok) throw new Error(json?.error || "Script execution failed.");
      setResult({
        stdout: json?.stdout ?? "",
        stderr: json?.stderr ?? "",
        error: json?.error ?? null,
        available: json?.available ?? true,
        inputRequired: json?.inputRequired,
      });
    } catch (err) {
      setResult({
        stdout: "",
        stderr: "",
        error: err instanceof Error ? err.message : "Script execution failed. Please try again.",
        available: true,
      });
    } finally {
      setRunning(false);
    }
  }, [code, getIdToken, language, running, stdin]);

  return {
    language,
    running,
    result,
    run,
    needsInput: needsInput || Boolean(result?.inputRequired),
    stdin,
    setStdin,
  };
}

export function CodeRunInput({
  show,
  stdin,
  onChange,
}: {
  show: boolean;
  stdin: string;
  onChange: (value: string) => void;
}) {
  if (!show) return null;

  return (
    <div className="chat-run-input">
      <label>Input</label>
      <textarea
        value={stdin}
        onChange={(event) => onChange(event.target.value)}
        placeholder="One input value per line..."
        rows={3}
        spellCheck={false}
      />
    </div>
  );
}

export function CodeRunOutput({
  result,
  running,
}: {
  result: CodeRunResult | null;
  running: boolean;
}) {
  const hasStdout = Boolean(result?.stdout.trim());
  const hasStderr = Boolean(result?.stderr.trim());
  const hasError = Boolean(result?.error?.trim());

  if (running) {
    return (
      <div className="chat-run-output">
        <div className="runner-empty">
          <span className="ring-spin" />
          Running in sandbox...
        </div>
      </div>
    );
  }

  if (!result) return null;

  if (result.available === false) {
    return (
      <div className="chat-run-output">
        <div className="runner-info">
          <Info size={16} />
          Code execution is not configured in this environment.
        </div>
      </div>
    );
  }

  return (
    <div className="chat-run-output">
      <div className={`runner-status ${hasError ? "error" : "success"}`}>
        {hasError ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
        <span>{hasError ? "Finished with error" : "Finished"}</span>
      </div>
      {hasStdout && (
        <section>
          <div className="code-exec-label">stdout</div>
          <pre className="code-exec-box output">{result.stdout}</pre>
        </section>
      )}
      {hasStderr && (
        <section>
          <div className="code-exec-label">stderr</div>
          <pre className="code-exec-box warning">{result.stderr}</pre>
        </section>
      )}
      {hasError && (
        <section>
          <div className="code-exec-label">error</div>
          <pre className="code-exec-box error">{result.error}</pre>
        </section>
      )}
      {!hasStdout && !hasStderr && !hasError && <pre className="code-exec-box empty">No output.</pre>}
    </div>
  );
}

export function RunCodeButton({
  running,
  onRun,
}: {
  running: boolean;
  onRun: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button className="copy" onClick={onRun} disabled={running} aria-label="Run code">
      {running ? <span className="ring-spin" /> : <Play size={13} fill="currentColor" />}
      {running ? "Running" : "Run"}
    </button>
  );
}

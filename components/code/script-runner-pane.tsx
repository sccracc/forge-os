"use client";

import { AlertCircle, CheckCircle2, Info, Play, Terminal } from "lucide-react";

type CodeExecutionLanguage = "python" | "javascript";

export interface ScriptRunResult {
  fileName: string;
  language: CodeExecutionLanguage;
  stdout: string;
  stderr: string;
  error: string | null;
  available: boolean;
  inputRequired?: boolean;
  ranAt: number;
}

export function ScriptRunnerPane({
  result,
  running,
  onRun,
  needsInput,
  stdin,
  onStdinChange,
}: {
  result: ScriptRunResult | null;
  running: boolean;
  onRun: () => void;
  needsInput: boolean;
  stdin: string;
  onStdinChange: (value: string) => void;
}) {
  const hasStdout = Boolean(result?.stdout.trim());
  const hasStderr = Boolean(result?.stderr.trim());
  const hasError = Boolean(result?.error?.trim());

  return (
    <div className="runner-wrap">
      <div className="runner-bar">
        <div className="runner-title">
          <Terminal size={15} />
          Script Output
        </div>
        <button className="btn-ghost runner-run" onClick={onRun} disabled={running}>
          {running ? <span className="ring-spin" /> : <Play size={14} fill="currentColor" />}
          {running ? "Running" : "Run"}
        </button>
      </div>

      <div className="runner-body">
        {needsInput && result?.available !== false && (
          <div className="runner-stdin">
            <label>Input</label>
            <textarea
              value={stdin}
              onChange={(event) => onStdinChange(event.target.value)}
              placeholder="One input value per line..."
              rows={4}
              spellCheck={false}
            />
          </div>
        )}
        {running ? (
          <div className="runner-empty">
            <span className="ring-spin" />
            Running script in the sandbox...
          </div>
        ) : !result ? (
          <div className="runner-empty">
            <Play size={18} />
            Run a Python or JavaScript file to see output here.
          </div>
        ) : result.available === false ? (
          <div className="runner-info">
            <Info size={16} />
            Code execution is not configured in this environment.
          </div>
        ) : (
          <>
            <div className={`runner-status ${hasError ? "error" : "success"}`}>
              {hasError ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
              <span>
                {hasError ? "Finished with error" : "Finished"} - {result.fileName}
              </span>
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
            {!hasStdout && !hasStderr && !hasError && (
              <pre className="code-exec-box empty">No output.</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

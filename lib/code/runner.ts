import "server-only";
import { Sandbox } from "@e2b/code-interpreter";
import { scriptNeedsInput } from "@/lib/code/run-utils";

export type CodeExecutionLanguage = "python" | "javascript";

export interface CodeExecutionResult {
  stdout: string;
  stderr: string;
  error: string | null;
  available: boolean;
  inputRequired?: boolean;
}

const EXECUTION_TIMEOUT_MS = 30_000;
const INPUT_REQUIRED_ERROR = "This script needs input. Enter one value per line and run again.";

function inputLines(stdin: string): string[] {
  return stdin.replace(/\r\n/g, "\n").split("\n");
}

function withPythonInput(code: string, stdin: string): string {
  return [
    "import builtins as __forge_builtins",
    `__forge_inputs = iter(${JSON.stringify(inputLines(stdin))})`,
    "def __forge_input(prompt=''):",
    "    if prompt:",
    "        print(prompt, end='')",
    "    try:",
    "        return next(__forge_inputs)",
    "    except StopIteration:",
    "        raise EOFError('Forge input exhausted. Add another input line and run again.')",
    "__forge_builtins.input = __forge_input",
    "try:",
    "    __forge_builtins.raw_input = __forge_input",
    "except Exception:",
    "    pass",
    "",
    code,
  ].join("\n");
}

function withJavaScriptInput(code: string, stdin: string): string {
  return [
    `const __forgeInputs = ${JSON.stringify(inputLines(stdin))};`,
    "let __forgeInputIndex = 0;",
    "globalThis.prompt = (message = '') => {",
    "  if (message) console.log(message);",
    "  if (__forgeInputIndex >= __forgeInputs.length) {",
    "    throw new Error('Forge input exhausted. Add another input line and run again.');",
    "  }",
    "  return __forgeInputs[__forgeInputIndex++];",
    "};",
    "",
    code,
  ].join("\n");
}

function codeWithInput(code: string, language: CodeExecutionLanguage, stdin: string): string {
  return language === "python" ? withPythonInput(code, stdin) : withJavaScriptInput(code, stdin);
}

function cleanExecutionError(value: string | undefined): { error: string | null; inputRequired?: boolean } {
  if (!value) return { error: null };
  if (/raw_input was called|frontend does not support input requests|input request/i.test(value)) {
    return { error: INPUT_REQUIRED_ERROR, inputRequired: true };
  }
  return { error: value };
}

export async function runCode(
  code: string,
  language: CodeExecutionLanguage,
  stdin = ""
): Promise<CodeExecutionResult> {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) {
    return {
      stdout: "",
      stderr: "",
      error: null,
      available: false,
    };
  }

  if (scriptNeedsInput(code, language) && !stdin.length) {
    return {
      stdout: "",
      stderr: "",
      error: INPUT_REQUIRED_ERROR,
      available: true,
      inputRequired: true,
    };
  }

  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.create({ apiKey });
    const result = await sandbox.runCode(stdin ? codeWithInput(code, language, stdin) : code, {
      language,
      timeoutMs: EXECUTION_TIMEOUT_MS,
      requestTimeoutMs: EXECUTION_TIMEOUT_MS,
    });
    const logs = result.logs ?? { stdout: [], stderr: [] };
    const cleanedError = cleanExecutionError(result.error?.value);

    const response: CodeExecutionResult = {
      stdout: (logs.stdout ?? []).join("\n"),
      stderr: (logs.stderr ?? []).join("\n"),
      error: cleanedError.error,
      available: true,
    };
    if (cleanedError.inputRequired) response.inputRequired = true;
    return response;
  } catch {
    return {
      stdout: "",
      stderr: "",
      error: "Execution failed. Please try again.",
      available: true,
    };
  } finally {
    try {
      await sandbox?.kill();
    } catch {
      /* cleanup best effort */
    }
  }
}

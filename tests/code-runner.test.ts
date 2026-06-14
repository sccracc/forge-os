import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCode } from "@/lib/code/runner";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  runCode: vi.fn(),
  kill: vi.fn(),
}));

vi.mock("@e2b/code-interpreter", () => ({
  Sandbox: {
    create: mocks.create,
  },
}));

const originalApiKey = process.env.E2B_API_KEY;

describe("E2B code runner", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.runCode.mockReset();
    mocks.kill.mockReset();
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.E2B_API_KEY;
    else process.env.E2B_API_KEY = originalApiKey;
  });

  it("returns unavailable without creating a sandbox when the key is missing", async () => {
    delete process.env.E2B_API_KEY;

    await expect(runCode("print('hi')", "python")).resolves.toEqual({
      stdout: "",
      stderr: "",
      error: null,
      available: false,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("asks for input before creating a sandbox when a Python script uses input", async () => {
    process.env.E2B_API_KEY = "e2b_test";

    await expect(runCode("name = input('Name: ')\nprint(name)", "python")).resolves.toEqual({
      stdout: "",
      stderr: "",
      error: "This script needs input. Enter one value per line and run again.",
      available: true,
      inputRequired: true,
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("wraps stdin for Python input before running in the sandbox", async () => {
    process.env.E2B_API_KEY = "e2b_test";
    mocks.create.mockResolvedValue({ runCode: mocks.runCode, kill: mocks.kill });
    mocks.runCode.mockResolvedValue({
      logs: { stdout: ["hello Jax"], stderr: [] },
      error: null,
    });

    await expect(runCode("name = input('Name: ')\nprint(f'hello {name}')", "python", "Jax")).resolves.toEqual({
      stdout: "hello Jax",
      stderr: "",
      error: null,
      available: true,
    });

    const [wrappedCode, options] = mocks.runCode.mock.calls[0];
    expect(wrappedCode).toContain("__forge_input");
    expect(wrappedCode).toContain('["Jax"]');
    expect(wrappedCode).toContain("print(f'hello {name}')");
    expect(options).toEqual({
      language: "python",
      timeoutMs: 30000,
      requestTimeoutMs: 30000,
    });
    expect(mocks.kill).toHaveBeenCalledOnce();
  });

  it("returns stdout, stderr, and errors from the sandbox result", async () => {
    process.env.E2B_API_KEY = "e2b_test";
    mocks.create.mockResolvedValue({ runCode: mocks.runCode, kill: mocks.kill });
    mocks.runCode.mockResolvedValue({
      logs: { stdout: ["hello", "world"], stderr: ["warn"] },
      error: { value: "boom" },
    });

    await expect(runCode("print('hello')", "python")).resolves.toEqual({
      stdout: "hello\nworld",
      stderr: "warn",
      error: "boom",
      available: true,
    });
    expect(mocks.create).toHaveBeenCalledWith({ apiKey: "e2b_test" });
    expect(mocks.runCode).toHaveBeenCalledWith("print('hello')", {
      language: "python",
      timeoutMs: 30000,
      requestTimeoutMs: 30000,
    });
    expect(mocks.kill).toHaveBeenCalledOnce();
  });

  it("kills the sandbox and returns a clean error when execution throws", async () => {
    process.env.E2B_API_KEY = "e2b_test";
    mocks.create.mockResolvedValue({ runCode: mocks.runCode, kill: mocks.kill });
    mocks.runCode.mockRejectedValue(new Error("provider exploded"));

    await expect(runCode("throw new Error('x')", "javascript")).resolves.toEqual({
      stdout: "",
      stderr: "",
      error: "Execution failed. Please try again.",
      available: true,
    });
    expect(mocks.kill).toHaveBeenCalledOnce();
  });

});

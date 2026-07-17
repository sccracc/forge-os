import "server-only";
import { resolveProviderModel } from "./models";
import type { ForgeModelId } from "./models.public";
import { EFFORT, type EffortId } from "./effort";
import { CONTINUATION_PROMPT } from "./prompts";
import type { WireMessage } from "./types";
import type { ToolGeneratedImage, ToolSpec } from "./tools";

// Combined safety cap for the agent loop: tool rounds + length-continuations.
const MAX_ROUNDS = 8;
// Conservative ceiling used only if the endpoint rejects a large request.
const FALLBACK_MAX_TOKENS = 8192;

export class ProviderNotConfiguredError extends Error {
  constructor() {
    super("AI provider is not configured");
    this.name = "ProviderNotConfiguredError";
  }
}
export class ProviderRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export interface CompletionOptions {
  modelId: ForgeModelId;
  effort: EffortId;
  thinking: boolean;
  systemPrompt: string;
  messages: WireMessage[];
  signal?: AbortSignal;
  /**
   * Hard override for the output-token ceiling, independent of effort. Forge
   * Code sets this to FORGE_CODE_MAX_OUTPUT_TOKENS so coding turns are never
   * truncated by a low effort level (see lib/code/forge-code-config.ts). When
   * unset, the effort-derived ceiling is used (normal chat behavior).
   */
  maxOutputTokens?: number;
  /** Tools offered to the model this turn (function-calling). */
  tools?: ToolSpec[];
  /** Executes a tool call and returns the result fed back to the model. */
  executeTool?: (call: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  }) => Promise<{
    content: string;
    count?: number;
    sources?: { title: string; url: string }[];
    image?: ToolGeneratedImage;
  }>;
}

/** Normalized events emitted to the route layer (provider-free). */
export type ProviderEvent =
  | { type: "reasoning"; delta: string }
  | { type: "content"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | {
      type: "tool_end";
      id: string;
      name: string;
      count: number;
      sources?: { title: string; url: string }[];
      image?: ToolGeneratedImage;
    }
  | {
      type: "done";
      finishReason: string;
      completionTokens: number;
      promptTokens: number;
      reasoningTokens: number;
    };

function baseUrl(): string {
  const raw = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  return raw.replace(/\/+$/, "");
}

export function toProviderMessages(systemPrompt: string, messages: WireMessage[]) {
  const out: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
  ];
  for (const m of messages) {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    // Reasoning must be replayed for tool-call turns or the provider errors (§9).
    if (m.reasoningContent && m.hadToolCall) {
      msg.reasoning_content = m.reasoningContent;
    }
    if (m.toolCallId) msg.tool_call_id = m.toolCallId;
    if (m.toolCalls) msg.tool_calls = m.toolCalls;
    out.push(msg);
  }
  return out;
}

// Forge's 5 effort levels → the provider's reasoning_effort buckets
// (low/medium/high/max). This is what makes effort scale how hard the model
// thinks in thinking mode.
const REASONING_EFFORT: Record<EffortId, "low" | "medium" | "high" | "max"> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "max",
};

interface BuildFlags {
  /** Send the thinking toggle param (`thinking: {type}`). */
  sendThinking: boolean;
  /** Send the `reasoning_effort` param (thinking mode only). */
  sendEffort: boolean;
  /**
   * Upper bound to clamp max_tokens to for this attempt (undefined = send the
   * full desired ceiling). The fallback steps this DOWN on a 400 so we always
   * land on the largest output the provider will actually accept — critical for
   * code, where the desired 384k can exceed the model's real max output and a
   * crash straight to 8k would truncate every file.
   */
  maxTokens?: number;
  /** Send the `tools` param (dropped only as a last-resort fallback). */
  sendTools: boolean;
}

function buildBody(
  opts: CompletionOptions,
  messages: WireMessage[],
  stream: boolean,
  flags: BuildFlags
) {
  const effort = EFFORT[opts.effort];
  // Forge Code pins the ceiling to a fixed max (opts.maxOutputTokens) so coding
  // turns are never truncated by effort; normal chat falls back to the
  // effort-derived ceiling. The continuation loop handles anything longer.
  const ceiling = opts.maxOutputTokens ?? effort.maxTokens;
  const body: Record<string, unknown> = {
    model: resolveProviderModel(opts.modelId),
    messages: toProviderMessages(opts.systemPrompt, messages),
    stream,
    max_tokens: flags.maxTokens != null ? Math.min(ceiling, flags.maxTokens) : ceiling,
  };
  if (stream) body.stream_options = { include_usage: true };
  // Thinking mode ignores temperature; effort sets it only when thinking is OFF.
  if (!opts.thinking) body.temperature = effort.tempNoThink;
  // Per-model thinking toggle (§3.1). V4 defaults thinking to ON, so the
  // explicit {type:"disabled"} must be sent to turn it OFF.
  if (flags.sendThinking) {
    body.thinking = { type: opts.thinking ? "enabled" : "disabled" };
  }
  // Effort drives reasoning depth in thinking mode.
  if (flags.sendThinking && flags.sendEffort && opts.thinking) {
    body.reasoning_effort = REASONING_EFFORT[opts.effort];
  }
  // Function-calling tools (e.g. web_search). Additive: omitted entirely when no
  // tools are offered, so non-tool requests are unchanged.
  if (opts.tools?.length && flags.sendTools) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  return body;
}

async function postProvider(
  opts: CompletionOptions,
  messages: WireMessage[],
  stream: boolean
): Promise<Response> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError();
  const url = `${baseUrl()}/chat/completions`;

  const send = (flags: BuildFlags) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildBody(opts, messages, stream, flags)),
      signal: opts.signal,
    });

  // Tiered fallback on a 400: step the output ceiling DOWN gradually (so we use
  // the largest max_tokens the provider accepts instead of crashing to 8k and
  // truncating code), keeping thinking/tools as long as possible; only drop
  // those as the final resorts so the user always gets an answer.
  // FORGE-NOTE: no behavior change when the endpoint accepts the full request —
  // the clamps only engage after a 400.
  const tiers: BuildFlags[] = [
    { sendThinking: true, sendEffort: true, maxTokens: undefined, sendTools: true },
    { sendThinking: true, sendEffort: true, maxTokens: 131072, sendTools: true },
    { sendThinking: true, sendEffort: true, maxTokens: 65536, sendTools: true },
    { sendThinking: true, sendEffort: true, maxTokens: 16384, sendTools: true },
    { sendThinking: true, sendEffort: false, maxTokens: FALLBACK_MAX_TOKENS, sendTools: true },
    // Last resort: drop tools too, so a tool-rejecting endpoint still answers.
    { sendThinking: false, sendEffort: false, maxTokens: FALLBACK_MAX_TOKENS, sendTools: false },
  ];

  let res: Response | null = null;
  for (let i = 0; i < tiers.length; i++) {
    res = await send(tiers[i]);
    if (res.status !== 400 || i === tiers.length - 1) break;
    try {
      res.body?.cancel();
    } catch {
      /* ignore */
    }
    console.warn(`[provider] request rejected (400); falling back (tier ${i + 1})`);
  }

  if (!res || !res.ok || !res.body) {
    const detail = res ? await res.text().catch(() => "") : "";
    throw new ProviderRequestError(res?.status ?? 500, detail.slice(0, 500));
  }
  return res;
}

interface ToolCallAcc {
  id: string;
  name: string;
  arguments: string;
}

interface OnceResult {
  finishReason: string;
  content: string;
  completionTokens: number;
  promptTokens: number;
  reasoningTokens: number;
  toolCalls: ToolCallAcc[];
  /** Reasoning text for this turn (captured even when not emitted) — replayed on
   *  tool-call turns per §9. */
  reasoning: string;
}

async function* streamOnce(
  opts: CompletionOptions,
  messages: WireMessage[],
  emitReasoning: boolean
): AsyncGenerator<ProviderEvent, OnceResult, unknown> {
  const res = await postProvider(opts, messages, true);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningText = "";
  let finishReason = "stop";
  let completionTokens = 0;
  let promptTokens = 0;
  let reasoningTokens = 0;
  // Tool-call deltas arrive piecewise; accumulate by index.
  const toolAcc: Record<number, ToolCallAcc> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line || !line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = (json.choices as Array<Record<string, unknown>>)?.[0];
      if (choice) {
        const delta = choice.delta as
          | {
              content?: string;
              reasoning_content?: string;
              reasoning?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }>;
            }
          | undefined;
        // Different OpenAI-compatible endpoints expose reasoning under
        // `reasoning_content` or `reasoning` — accept either.
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (reasoning) {
          reasoningText += reasoning;
          // Emit only on the first segment (preserves the thinking-timer
          // semantics); always captured so it can be replayed on tool turns.
          if (emitReasoning) yield { type: "reasoning", delta: reasoning };
        }
        if (delta?.content) {
          content += delta.content;
          yield { type: "content", delta: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = toolAcc[idx] ?? { id: "", name: "", arguments: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.arguments += tc.function.arguments;
            toolAcc[idx] = cur;
          }
        }
        if (choice.finish_reason) finishReason = String(choice.finish_reason);
      }
      const usage = json.usage as
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            reasoning_tokens?: number;
            completion_tokens_details?: { reasoning_tokens?: number };
          }
        | undefined;
      if (usage) {
        if (typeof usage.prompt_tokens === "number") promptTokens = usage.prompt_tokens;
        if (typeof usage.completion_tokens === "number") completionTokens = usage.completion_tokens;
        const rt = usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens;
        if (typeof rt === "number") reasoningTokens = rt;
      }
    }
  }
  const toolCalls = Object.values(toolAcc).filter((c) => c.id && c.name);
  return {
    finishReason,
    content,
    completionTokens,
    promptTokens,
    reasoningTokens,
    toolCalls,
    reasoning: reasoningText,
  };
}

/**
 * Streams a completion through an agent loop that handles BOTH:
 *  - tool calls (§9): when the model calls a tool, execute it, feed the result
 *    back, and continue streaming the answer in the same bubble; and
 *  - output limits (§3.3): transparently continue across the provider's max.
 * Reasoning is emitted only on the first segment, preserving the thinking-timer
 * semantics. When no tools are offered, behavior is identical to before.
 */
export async function* streamForgeCompletion(
  opts: CompletionOptions
): AsyncGenerator<ProviderEvent> {
  // `baseContext` grows when tools are used (the assistant tool-call turn + its
  // tool results). `answer` is the current answer text, replayed for a
  // length-continuation.
  let baseContext: WireMessage[] = [...opts.messages];
  let answer = "";
  let totalTokens = 0;
  let totalPromptTokens = 0;
  let totalReasoningTokens = 0;
  let lastFinish = "stop";
  let firstTurn = true;
  const canUseTools = !!opts.executeTool && (opts.tools?.length ?? 0) > 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const emitReasoning = firstTurn && opts.thinking;
    const working: WireMessage[] = answer
      ? [
          ...baseContext,
          { role: "assistant", content: answer },
          { role: "user", content: CONTINUATION_PROMPT },
        ]
      : baseContext;

    const gen = streamOnce(opts, working, emitReasoning);
    let segText = "";
    let result: OnceResult | undefined;
    while (true) {
      const step = await gen.next();
      if (step.done) {
        result = step.value;
        break;
      }
      const ev = step.value;
      if (ev.type === "content") {
        segText += ev.delta;
        answer += ev.delta;
      }
      yield ev;
    }

    totalTokens += result!.completionTokens;
    totalPromptTokens += result!.promptTokens;
    totalReasoningTokens += result!.reasoningTokens;
    lastFinish = result!.finishReason;
    firstTurn = false;

    // 1) Tool calls → execute them, feed results back, then loop to stream the answer.
    if (canUseTools && result!.toolCalls.length > 0) {
      baseContext = [
        ...baseContext,
        {
          role: "assistant",
          content: segText,
          hadToolCall: true,
          reasoningContent: result!.reasoning || undefined,
          toolCalls: result!.toolCalls.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: { name: c.name, arguments: c.arguments },
          })),
        },
      ];
      for (const call of result!.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = {};
        }
        yield { type: "tool_start", id: call.id, name: call.name, args };
        const r = await opts.executeTool!({ id: call.id, name: call.name, args });
        baseContext.push({ role: "tool", content: r.content, toolCallId: call.id });
        yield {
          type: "tool_end",
          id: call.id,
          name: call.name,
          count: r.count ?? 0,
          sources: r.sources,
          image: r.image,
        };
      }
      answer = ""; // a fresh answer follows the tool results
      continue;
    }

    // 2) Output limit → continue the same answer (content only, §3.5).
    if (lastFinish === "length" && round < MAX_ROUNDS - 1) {
      continue;
    }

    break;
  }

  yield {
    type: "done",
    finishReason: lastFinish,
    completionTokens: totalTokens,
    promptTokens: totalPromptTokens,
    reasoningTokens: totalReasoningTokens,
  };
}

/** Single-shot, non-streaming completion. Used for titles, memory, and summaries. */
export async function generateText(
  opts: Omit<CompletionOptions, "thinking"> & { thinking?: boolean }
): Promise<string> {
  const res = await postProvider(
    { ...opts, thinking: opts.thinking ?? false },
    opts.messages,
    false
  );
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

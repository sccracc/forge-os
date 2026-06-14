import "server-only";
import { searchConfigured, searchWeb } from "@/lib/search";
import { generateImage, siliconFlowApiKey } from "@/lib/images/siliconflow";
import { storeImageFromUrl } from "@/lib/supabase/storage";
import type { ImageMimeType } from "@/lib/data/types";

/** OpenAI-compatible function tool schema. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const WEB_SEARCH_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current or hard-to-verify information and get back ranked results with links. Call this PROACTIVELY and WITHOUT asking the user's permission whenever answering accurately needs facts you do not reliably hold: recent or current events, news, prices, stats, standings, schedules, weather, today's date, or the latest releases/versions/models/products/benchmarks/comparisons — anything that may have changed since your training, or any factual claim you cannot confidently verify from memory. Critically: if you are about to hedge with phrases like 'I don't have up-to-date information', 'as of my last update', 'I can't verify', 'these may be hypothetical/very recent', or to suggest the user go search themselves — call this tool INSTEAD, then answer from the results. Always call it when the user explicitly asks you to look something up. Do NOT use it for stable, timeless knowledge (math, definitions, general programming, established facts/history), for content the user already provided, or for purely creative/opinion tasks. You may call it multiple times in one turn to research different aspects.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The specific search query. Be concise and use natural search terms.",
        },
        reason: {
          type: "string",
          description:
            "One sentence explaining why you are searching — shown to the user.",
        },
        count: {
          type: "integer",
          description:
            "How many results to return (1–10, default 5). Use more for broad research or comparisons, fewer for a single quick fact. (More results cost no extra search quota.)",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["query", "reason"],
    },
  },
};

export const GENERATE_IMAGE_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Generate an image from a text description with the user's available Forge Image model, or edit the attached image when the user uploaded one and asks for a change. Use this tool when the user asks to generate, create, draw, design, make, visualize, edit, modify, enhance, restyle, replace, remove, or transform an image, illustration, photo, logo, banner, icon, or any visual content.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "A detailed image generation prompt. Improve the user's request with art style, lighting, composition, color palette, camera details, and quality descriptors.",
        },
        loading_text: {
          type: "string",
          description:
            "A short sentence shown while the image generates. Example: Generating your futuristic city at night...",
        },
      },
      required: ["prompt", "loading_text"],
    },
  },
};

/** A source surfaced to the UI (favicon + link chips). */
export interface ToolSource {
  title: string;
  url: string;
}

export interface ToolGeneratedImage {
  loadingText?: string;
  imageUrl?: string;
  prompt?: string;
  error?: string;
  /** Disclaimer shown when we fell back to the standard model (half-counts). */
  notice?: string;
}

export interface ToolExecResult {
  /** String fed back to the model as the tool result. */
  content: string;
  /** Number of results (drives the "Found N results" chip). */
  count: number;
  /** Result links shown to the user as source pills. */
  sources?: ToolSource[];
  /** Generated image metadata shown to the user as an image card. */
  image?: ToolGeneratedImage;
}

const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

function hasSiliconFlowApiKey(): boolean {
  return Boolean(siliconFlowApiKey());
}

/**
 * Executes a web_search tool call. Never throws.
 * Returns an error result the model can read in the not-configured / empty cases.
 */
export async function executeWebSearch(args: {
  query?: string;
  reason?: string;
  count?: number;
}): Promise<ToolExecResult> {
  const empty: ToolSource[] = [];
  if (!searchConfigured()) {
    return { content: JSON.stringify({ error: "Web search is not configured." }), count: 0, sources: empty };
  }
  const query = (args.query ?? "").trim();
  if (!query) {
    return { content: JSON.stringify({ error: "No search query provided." }), count: 0, sources: empty };
  }

  // The model chooses how many results to fetch; clamp to a sane range.
  const count = Math.min(
    MAX_COUNT,
    Math.max(1, Math.round(Number(args.count) || DEFAULT_COUNT))
  );

  const results = await searchWeb(query, count);
  if (results.length === 0) {
    return { content: JSON.stringify({ error: "No results found for that query." }), count: 0, sources: empty };
  }

  const body = results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`)
    .join("\n\n");
  const content = `Web search results for: '${query}'\n\n${body}`;
  return {
    content,
    count: results.length,
    sources: results.map((r) => ({ title: r.title, url: r.url })),
  };
}

export async function executeGenerateImage(
  args: {
    prompt?: string;
    loading_text?: string;
  },
  ctx?: {
    uid?: string;
    plan?: string;
    inputImage?: { base64: string; mimeType: ImageMimeType };
    editRequested?: boolean;
  }
): Promise<ToolExecResult> {
  const prompt = (args.prompt ?? "").trim();
  const loadingText = (args.loading_text ?? "").trim() || "Generating your image...";
  if (!hasSiliconFlowApiKey()) {
    const error = "Image generation is not configured.";
    return {
      content: JSON.stringify({ error }),
      count: 0,
      image: { loadingText, error },
    };
  }
  if (!prompt) {
    const error = "No image prompt provided.";
    return {
      content: JSON.stringify({ error }),
      count: 0,
      image: { loadingText, error },
    };
  }

  try {
    const { url: tempUrl, fellBack } = await generateImage(prompt, {
      plan: ctx?.plan,
      mode: ctx?.editRequested && ctx?.inputImage ? "edit" : "generate",
      inputImageBase64: ctx?.inputImage?.base64,
      inputMimeType: ctx?.inputImage?.mimeType,
    });
    // Re-host the provider's temporary URL to permanent Supabase Storage so the
    // image survives expiry + reloads. Falls back to the temp URL on failure.
    const storedUrl = await storeImageFromUrl(ctx?.uid ?? "anon", tempUrl);
    const imageUrl = storedUrl ?? tempUrl;
    // When the premium model was unavailable and we served the standard model
    // instead, apologize and only charge half an image. Public names only — no
    // provider identifiers (provider-secrecy invariant).
    const notice = fellBack
      ? "Forge Image Pro is temporarily unavailable, so we created this with the standard Forge Image model instead. Sorry about that — this only counts as half an image toward your monthly limit."
      : undefined;
    return {
      content: JSON.stringify(notice ? { imageUrl, prompt, notice } : { imageUrl, prompt }),
      count: fellBack ? 0.5 : 1,
      image: { loadingText, imageUrl, prompt, notice },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Image generation failed. Please try again.";
    return {
      content: JSON.stringify({ error }),
      count: 0,
      image: { loadingText, error },
    };
  }
}

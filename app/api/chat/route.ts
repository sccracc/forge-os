import { NextRequest } from "next/server";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { chatRequestSchema, encodeEvent, type WireMessage } from "@/lib/ai/types";
import { assembleSystemPrompt } from "@/lib/ai/prompts";
import { loadUserPromptContext, loadProjectPromptContext, loadAgentInstructions } from "@/lib/ai/context-server";
import { maybeCollapse } from "@/lib/ai/collapse";
import { withActiveSkillTurnInstruction } from "@/lib/ai/skill-execution";
import {
  streamForgeCompletion,
  ProviderNotConfiguredError,
  ProviderRequestError,
} from "@/lib/ai/provider";
import { FORGE_CODE_MAX_OUTPUT_TOKENS, isForgeCodeMode } from "@/lib/code/forge-code-config";
import type { ContextBlock } from "@/lib/ai/prompts";
import { incrementUsage } from "@/lib/supabase/usage";
import { getUsageContext } from "@/lib/usage/server";
import { checkTokenLimit } from "@/lib/usage/check";
import { deductTokens } from "@/lib/usage/deduct";
import { estimateTokens } from "@/lib/usage/compute";
import {
  canUseModel,
  canUseEffort,
  canUseThinking,
  getFeatureLimit,
  getUpgradeMessage,
  getRequiredPlan,
} from "@/lib/plans/gates";
import {
  GENERATE_IMAGE_TOOL,
  WEB_SEARCH_TOOL,
  executeGenerateImage,
  executeWebSearch,
} from "@/lib/ai/tools";
import {
  CODE_PROJECT_TOOLS,
  executeReadProjectFiles,
  executeSearchProject,
} from "@/lib/ai/code-tools";
import { analyzeImages, type VisionImage } from "@/lib/vision/gemini";
import { siliconFlowApiKey } from "@/lib/images/siliconflow";
import { imageModelLabelForPlan } from "@/lib/images/public";
import { searchConfigured } from "@/lib/search";
import {
  buildForgeOsKnowledgeSkill,
  shouldUseForgeOsKnowledge,
} from "@/lib/skills/forge-os-internal";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Fixed baseline input charged on every chat request, representing the default
 * per-request input that always goes through (independent of message length).
 * Multiplied by the model/thinking multiplier like any other real token.
 */
const BASE_INPUT_TOKENS = 500;

function hasImageEditIntent(text: string): boolean {
  return /\b(edit|change|modify|replace|remove|add|enhance|upscale|restore|retouch|recolor|colorize|fix|adjust|transform|background|crop|resize|style|filter)\b|turn\s+(?:this|it)\s+into|make\s+(?:this|it)/i.test(
    text
  );
}

function friendlyError(err: unknown): string {
  if (err instanceof ProviderNotConfiguredError) {
    return "Forge isn't fully configured yet. Check the server chat configuration.";
  }
  if (err instanceof ProviderRequestError) {
    if (err.status === 429)
      return "Forge is getting a lot of requests right now. Please try again in a moment.";
    if (err.status >= 500)
      return "Forge ran into a problem reaching the model. Please try again.";
    return "Something went wrong generating a response. Please try again.";
  }
  if (err instanceof Error && err.name === "AbortError") return "";
  return "Something went wrong. Please try again.";
}

export async function POST(req: NextRequest) {
  // 1. Verify the Firebase ID token (never trust a client uid).
  let user;
  try {
    user = await verifyRequest(req);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.error("[chat auth]", err);
    return jsonError("Forge auth is misconfigured. Check Firebase Admin credentials.", 500);
  }
  if (!user) return jsonError("unauthorized", 401);
  const uid = user.uid;

  // 2. Quiet rate cap.
  if (!checkRateLimit(user.uid)) {
    return jsonError("Forge is busy, try again shortly.", 429);
  }

  // 3. Validate.
  let parsed;
  try {
    parsed = chatRequestSchema.parse(await req.json());
  } catch {
    return jsonError("invalid request", 400);
  }

  const {
    messages,
    forgeModelId,
    effort,
    thinking,
    mode,
    toolsEnabled,
    skillSlugs,
    skills,
    skillCatalog,
    connectorIds,
    agentId,
    conversationId,
    conversationTitle,
    projectId,
    incognito,
    projectContext,
    webSearch,
    attachedImages,
    documents,
    scannedPdfs,
  } = parsed;
  const images = attachedImages ?? [];
  const docs = documents ?? [];
  const scanned = scannedPdfs ?? [];

  // 3.5 Plan + usage context (§STEP 2 gating + §STEP 1 token pre-check).
  const usageCtx = await getUsageContext(uid);
  const plan = usageCtx.plan;
  const latestUserText =
    [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  // Image editing is only unambiguous with exactly one attached image.
  const imageEditRequested = images.length === 1 && hasImageEditIntent(latestUserText);
  const editImage = imageEditRequested ? images[0] : undefined;

  // Plan gates — model / effort / thinking. Return 403 plan_gate BEFORE the
  // token check so the client can show the "Feature Locked" upgrade modal.
  const planGate = (feature: string, label: string, requiredPlan: string) =>
    Response.json(
      { error: "plan_gate", feature, message: getUpgradeMessage(plan, label), requiredPlan },
      { status: 403 }
    );
  if (!canUseModel(plan, forgeModelId)) return planGate("model", "Magnum 2.8", "pro");
  if (!canUseEffort(plan, effort)) {
    return planGate(
      "effort",
      effort === "max" ? "Max effort" : "Extra High effort",
      effort === "max" ? "max" : "pro"
    );
  }
  if (thinking && !canUseThinking(plan, forgeModelId)) {
    return planGate("thinking", "Thinking mode", "starter");
  }

  const limitCheck = await checkTokenLimit(uid, plan);
  if (!limitCheck.allowed) {
    return new Response(
      JSON.stringify({
        error: "usage_limit",
        message: limitCheck.message,
        reason: limitCheck.reason,
        resetsAt: limitCheck.resetsAt?.toISOString(),
      }),
      { status: 429, headers: { "content-type": "application/json" } }
    );
  }

  // web_search / image gen are offered only when the key is set, the toggle is
  // on (search), AND the plan allows the feature (monthly limit > 0).
  const searchLimit = getFeatureLimit(plan, "searches");
  const imageLimit = getFeatureLimit(plan, "images");
  const visionLimitForStatus = getFeatureLimit(plan, "vision");
  const searchProviderConfigured = searchConfigured();
  const imageProviderConfigured = Boolean(siliconFlowApiKey());
  const imageModelLabel = imageModelLabelForPlan(plan);
  const webSearchAvailable = webSearch !== false && searchProviderConfigured && searchLimit > 0;
  const imageGenAvailable = imageProviderConfigured && imageLimit > 0;
  // Forge Code project tools: every code-mode call scoped to a real project can
  // read exact file contents / search the project mid-generation instead of
  // guessing. Reads are uid+project scoped server-side and consume no quota.
  const codeToolsAvailable = isForgeCodeMode(mode) && Boolean(projectId);
  const webSearchStatus =
    searchLimit === 0
      ? `plan locked - ${getUpgradeMessage(plan, "Web search")}`
      : !searchProviderConfigured
        ? "not configured"
        : webSearch === false
          ? "off by user toggle"
          : "available";
  const imageGenerationStatus =
    imageLimit === 0
      ? `plan locked - ${getUpgradeMessage(plan, "Image generation")}`
      : !imageProviderConfigured
        ? "not configured"
        : `available (${imageModelLabel})`;
  const imageUnderstandingStatus =
    visionLimitForStatus === 0
      ? `plan locked - ${getUpgradeMessage(plan, "Image understanding")}`
      : !process.env.GEMINI_API_KEY
        ? "not configured"
        : "available";
  const attachedImageMode = images.length ? (imageEditRequested ? "edit" : "vision") : "none";
  const internalForgeOsKnowledge = shouldUseForgeOsKnowledge(latestUserText)
    ? buildForgeOsKnowledgeSkill(plan)
    : undefined;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // OUTPUT TOKEN POLICY — every Forge Code turn (build / discuss / plan) gets
  // the fixed maximum output budget regardless of effort, so coding output is
  // never truncated. Normal chat keeps the effort-derived ceiling (undefined).
  const maxOutputTokens = isForgeCodeMode(mode) ? FORGE_CODE_MAX_OUTPUT_TOKENS : undefined;

  const encoder = new TextEncoder();
  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());

  // 4. Build the working message list, dropping client-sent system turns and
  //    collapse long histories (§3.5): summarize older turns, keep recent ones.
  let visionCount = 0;
  let documentCount = 0;
  let filtered: WireMessage[] = messages.filter((m) => m.role !== "system");

  if (images.length || docs.length || scanned.length) {
    const lastUserIndex = filtered.findLastIndex((message) => message.role === "user");
    if (lastUserIndex < 0) return jsonError("Attachments require a user message.", 400);
    const userMessage = filtered[lastUserIndex].content;
    const blocks: string[] = [];

    // (A) Images. Single image + edit intent → hand to the image-editing tool;
    //     otherwise analyze all attached images with Forge Vision.
    if (imageEditRequested) {
      if (getFeatureLimit(plan, "images") === 0) {
        return planGate("images", "Image generation", getRequiredPlan("Image generation"));
      }
      if (!siliconFlowApiKey()) return jsonError("Image generation is not configured.", 500);
      if (usageCtx.images >= getFeatureLimit(plan, "images")) {
        return Response.json(
          { error: "plan_gate", feature: "images", message: "You've reached your monthly image generation limit.", requiredPlan: "starter" },
          { status: 403 }
        );
      }
      blocks.push(
        `[Image attached for editing. The user is asking Forge to modify the attached image. ` +
          `Call generate_image with a concise edit prompt; Forge will route it through the image editing model using the attached image.]`
      );
    } else if (images.length) {
      if (!process.env.GEMINI_API_KEY) return jsonError("Image understanding is not configured.", 500);
      const visionLimit = getFeatureLimit(plan, "vision");
      if (visionLimit === 0) {
        return planGate("vision", "Image understanding", getRequiredPlan("Image understanding"));
      }
      if (usageCtx.vision + images.length > visionLimit) {
        return Response.json(
          { error: "plan_gate", feature: "vision", message: "You've reached your monthly image understanding limit.", requiredPlan: "pro" },
          { status: 403 }
        );
      }
      try {
        const analysis = await analyzeImages(images as VisionImage[], userMessage, "image");
        blocks.push(`[Images attached - Forge Vision Analysis:\n${analysis}\n---]`);
        visionCount = images.length;
      } catch (err) {
        return jsonError(
          err instanceof Error ? err.message : "Forge couldn't analyze the attached image.",
          500
        );
      }
    }

    // (B) Free document text (parsed in the browser — no gate, no count).
    for (const doc of docs) {
      blocks.push(`[Document attached "${doc.name}":\n${doc.text}\n---]`);
    }

    // (C) Scanned PDFs — AI-analyzed (gated "Document analysis", counted).
    if (scanned.length) {
      if (!process.env.GEMINI_API_KEY) return jsonError("Document analysis is not configured.", 500);
      const docLimit = getFeatureLimit(plan, "documents");
      if (docLimit === 0) {
        return planGate("documents", "Document analysis", getRequiredPlan("Document analysis"));
      }
      if (usageCtx.documents + scanned.length > docLimit) {
        return Response.json(
          { error: "plan_gate", feature: "documents", message: "You've reached your monthly document limit.", requiredPlan: "starter" },
          { status: 403 }
        );
      }
      for (const pdf of scanned) {
        try {
          const analysis = await analyzeImages(pdf.pages as VisionImage[], userMessage, "document");
          blocks.push(`[Scanned document "${pdf.name}":\n${analysis}\n---]`);
          documentCount += 1;
        } catch (err) {
          return jsonError(
            err instanceof Error ? err.message : `Could not analyze "${pdf.name}".`,
            500
          );
        }
      }
    }

    if (blocks.length) {
      const enhanced = `${blocks.join("\n")}\nUser's message: ${userMessage}`;
      filtered = filtered.map((message, index) =>
        index === lastUserIndex ? { ...message, content: enhanced } : message
      );
    }
  }
  // Then collapse long histories: summarize older turns, keep recent ones.
  const { working, summary } = await maybeCollapse(filtered, ac.signal);

  // 5. Layer in real context: personalization + memory (server-side), project
  //    instructions + FORGE.md, the collapse summary, and project files.
  const userCtx = await loadUserPromptContext(user.uid);
  const projectCtx = projectId ? await loadProjectPromptContext(user.uid, projectId) : {};
  const agentInstructions = agentId ? await loadAgentInstructions(user.uid, agentId) : undefined;
  const contextBlocks: ContextBlock[] = [];
  if (summary) contextBlocks.push({ label: "Earlier conversation summary", content: summary });
  if (projectContext) contextBlocks.push({ label: "Project files", content: projectContext });

  const systemPrompt = assembleSystemPrompt({
    effort,
    mode,
    date: today,
    toolsEnabled,
    webSearchAvailable,
    imageGenAvailable,
    codeToolsAvailable,
    skills,
    skillCatalog,
    agentInstructions,
    customInstructions: userCtx.customInstructions,
    memory: incognito ? undefined : userCtx.memory,
    projectInstructions: projectCtx.projectInstructions,
    forgeMd: projectCtx.forgeMd,
    contextBlocks: contextBlocks.length ? contextBlocks : undefined,
    internalForgeOsKnowledge,
    currentState: {
      model: forgeModelId,
      effort,
      thinking,
      mode,
      plan,
      toolsEnabled,
      webSearchAvailable,
      webSearchStatus,
      imageGenAvailable,
      imageGenerationStatus,
      imageUnderstandingStatus,
      attachedImageMode,
      activeSkillSlugs: skillSlugs,
      activeAgentId: agentId,
      connectorIds,
      conversationId,
      conversationTitle,
      projectId,
      incognito,
    },
  });
  const generationMessages = withActiveSkillTurnInstruction(working, skills);

  const tools = [
    ...(webSearchAvailable ? [WEB_SEARCH_TOOL] : []),
    ...(imageGenAvailable ? [GENERATE_IMAGE_TOOL] : []),
    ...(codeToolsAvailable ? CODE_PROJECT_TOOLS : []),
  ];
  let searchCount = 0;
  let imageCount = 0;
  const executeTool = async (call: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  }) => {
    if (call.name === "web_search") {
      const limit = getFeatureLimit(plan, "searches");
      if (limit === 0) {
        return { content: JSON.stringify({ error: getUpgradeMessage(plan, "Web search") }), count: 0 };
      }
      if (usageCtx.searches + searchCount >= limit) {
        return { content: JSON.stringify({ error: "Monthly search limit reached." }), count: 0 };
      }
      const r = await executeWebSearch(call.args as { query?: string; reason?: string });
      searchCount += 1;
      return r;
    }
    if (codeToolsAvailable && call.name === "read_project_files" && projectId) {
      return executeReadProjectFiles(uid, projectId, call.args as { paths?: unknown });
    }
    if (codeToolsAvailable && call.name === "search_project" && projectId) {
      return executeSearchProject(
        uid,
        projectId,
        call.args as { pattern?: unknown; regex?: unknown }
      );
    }
    if (call.name === "generate_image") {
      const limit = getFeatureLimit(plan, "images");
      if (limit === 0) {
        const msg = getUpgradeMessage(plan, "Image generation");
        return { content: JSON.stringify({ error: msg }), count: 0, image: { error: msg } };
      }
      if (usageCtx.images + imageCount >= limit) {
        const msg = "Monthly image generation limit reached.";
        return { content: JSON.stringify({ error: msg }), count: 0, image: { error: msg } };
      }
      const r = await executeGenerateImage(
        call.args as { prompt?: string; loading_text?: string },
        {
          uid,
          plan,
          inputImage: editImage,
          editRequested: imageEditRequested,
        }
      );
      // Count what the tool reported: 1 for a normal image, 0.5 for a fallback.
      if (r.image?.imageUrl && !r.image?.error) imageCount += r.count ?? 0;
      return r;
    }
    return { content: JSON.stringify({ error: `Unknown tool: ${call.name}` }), count: 0 };
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finish = "stop";
      let tokens = 0;
      let reasoningTokens = 0;
      const searchQueries = new Map<string, string>(); // tool-call id -> query
      try {
        for await (const ev of streamForgeCompletion({
          modelId: forgeModelId,
          effort,
          thinking,
          systemPrompt,
          messages: generationMessages,
          signal: ac.signal,
          tools,
          executeTool,
          maxOutputTokens,
        })) {
          if (ev.type === "reasoning") {
            controller.enqueue(encoder.encode(encodeEvent({ t: "reasoning", d: ev.delta })));
          } else if (ev.type === "content") {
            controller.enqueue(encoder.encode(encodeEvent({ t: "content", d: ev.delta })));
          } else if (ev.type === "tool_start") {
            // Project-tool reads are internal agent plumbing — no UI chip.
            if (ev.name === "read_project_files" || ev.name === "search_project") continue;
            if (ev.name === "generate_image") {
              const loadingText =
                typeof ev.args.loading_text === "string"
                  ? ev.args.loading_text
                  : "Generating your image...";
              controller.enqueue(
                encoder.encode(encodeEvent({ t: "image", id: ev.id, loadingText, done: false }))
              );
              continue;
            }
            const q = typeof ev.args.query === "string" ? ev.args.query : "";
            searchQueries.set(ev.id, q);
            controller.enqueue(
              encoder.encode(encodeEvent({ t: "status", id: ev.id, d: q, done: false }))
            );
          } else if (ev.type === "tool_end") {
            if (ev.name === "read_project_files" || ev.name === "search_project") continue;
            if (ev.name === "generate_image") {
              controller.enqueue(
                encoder.encode(
                  encodeEvent({
                    t: "image",
                    id: ev.id,
                    loadingText: ev.image?.loadingText,
                    done: true,
                    imageUrl: ev.image?.imageUrl,
                    prompt: ev.image?.prompt,
                    error: ev.image?.error,
                    notice: ev.image?.notice,
                  })
                )
              );
              continue;
            }
            const q = searchQueries.get(ev.id) ?? "";
            controller.enqueue(
              encoder.encode(
                encodeEvent({
                  t: "status",
                  id: ev.id,
                  d: q,
                  done: true,
                  n: ev.count,
                  sources: ev.sources,
                })
              )
            );
          } else if (ev.type === "done") {
            finish = ev.finishReason;
            tokens = ev.completionTokens;
            reasoningTokens = ev.reasoningTokens;
          }
        }

        // §STEP 2 — deduct Forge tokens (real × multiplier). Bill a fixed
        // BASE_INPUT_TOKENS for the default per-request input (so every request
        // visibly consumes a small baseline), PLUS the user's OWN tokens: their
        // actual input this turn (the latest user message, including any merged
        // image-analysis) + the model's output (completion + reasoning). The
        // rest of the fixed input — full system prompt, memory, skills, project
        // context, resent history, tool results — is NOT charged, so the real
        // prompt_tokens count is intentionally excluded here.
        const userInputText =
          [...filtered].reverse().find((m) => m.role === "user")?.content ?? "";
        const realTokens =
          BASE_INPUT_TOKENS + estimateTokens(userInputText) + tokens + reasoningTokens;
        const deduction = await deductTokens(uid, plan, realTokens, forgeModelId, thinking);
        controller.enqueue(
          encoder.encode(
            encodeEvent({
              t: "done",
              finish,
              tokens,
              realTokens: deduction.realTokens,
              forgeTokens: deduction.forgeTokens,
              multiplier: deduction.multiplier,
            })
          )
        );
        // §STEP 3 — per-feature monthly counters. Await this before closing the
        // stream so the client's immediate usage refresh sees the new counters.
        await incrementUsage(uid, {
          searches: searchCount,
          images: imageCount,
          vision: visionCount,
          documents: documentCount,
        });
      } catch (err) {
        if (process.env.NODE_ENV !== "production") console.error("[chat]", err);
        const msg = friendlyError(err);
        if (msg) {
          controller.enqueue(encoder.encode(encodeEvent({ t: "error", d: msg })));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

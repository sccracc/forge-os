import "server-only";
import { resolvePlanId } from "@/lib/plans/limits";

const SILICONFLOW_IMAGE_URLS = [
  "https://api.siliconflow.com/v1/images/generations",
  "https://api.siliconflow.cn/v1/images/generations",
] as const;

export const SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL = "Tongyi-MAI/Z-Image-Turbo";
export const SILICONFLOW_TEXT_IMAGE_MAX_ULTRA_MODEL = "black-forest-labs/FLUX.2-pro";
export const SILICONFLOW_IMAGE_EDIT_MODEL = "black-forest-labs/FLUX.1-Kontext-dev";

export type SiliconFlowImageMode = "generate" | "edit";

interface SiliconFlowImageResponse {
  images?: { url?: string }[];
  data?: { url?: string }[];
  url?: string;
  error?: { message?: string; code?: string | number };
  message?: string;
}

function firstImageUrl(json: SiliconFlowImageResponse): string | undefined {
  return json.images?.[0]?.url ?? json.data?.[0]?.url ?? json.url;
}

export interface GenerateImageOptions {
  plan?: string;
  mode?: SiliconFlowImageMode;
  inputImageBase64?: string;
  inputMimeType?: string;
}

export function imageModelForPlan(plan: string | undefined, mode: SiliconFlowImageMode): string {
  if (mode === "edit") return SILICONFLOW_IMAGE_EDIT_MODEL;
  const planId = resolvePlanId(plan);
  return planId === "max" || planId === "ultra"
    ? SILICONFLOW_TEXT_IMAGE_MAX_ULTRA_MODEL
    : SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL;
}

// Provider secrecy: these messages reach the client (GeneratedImageErrorCard
// renders them verbatim), so they must never name the underlying vendor or
// forward raw upstream error text. The raw detail is logged server-side where
// the caller already logs status + body; keep the operator hint in the log only.
function friendlySiliconFlowError(status: number, detail?: string): Error {
  if (detail) console.error("[imagegen] upstream error", status, detail);
  if (status === 401) {
    return new Error("Image generation isn't fully configured on this deployment.");
  }
  if (status === 422) {
    return new Error("The image prompt was rejected. Try rephrasing it.");
  }
  if (status === 429) return new Error("Image generation is busy right now. Please try again shortly.");
  if (status >= 500) {
    return new Error("Image generation is temporarily unavailable. Please try again.");
  }
  return new Error("Image generation failed. Please try again.");
}

export function siliconFlowApiKey(): string | undefined {
  let value = process.env.SILICONFLOW_API_KEY?.trim();
  if (!value) return undefined;

  const assignment = value.match(/^SILICONFLOW_API_KEY\s*=\s*(.+)$/i);
  if (assignment) value = assignment[1].trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  value = value.replace(/^Bearer\s+/i, "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  return value || undefined;
}

function imageSizeForModel(): string {
  return "1024x1024";
}

async function postSiliconFlowImage(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  options: GenerateImageOptions = {}
): Promise<Response> {
  const mode = options.mode ?? "generate";
  // SiliconFlow's FLUX family (FLUX.2-pro, FLUX.1-Kontext) rejects `batch_size`
  // and 500s with "Request failed: Unknown error" when it's present. Only the
  // non-FLUX models (e.g. Z-Image-Turbo) accept it.
  const isFluxModel = /flux/i.test(model);
  const body: Record<string, unknown> = {
    model,
    prompt,
    image_size: imageSizeForModel(),
  };
  if (!isFluxModel) body.batch_size = 1;

  if (mode === "edit" && options.inputImageBase64 && options.inputMimeType) {
    body.image = `data:${options.inputMimeType};base64,${options.inputImageBase64}`;
  } else if (model === SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL) {
    body.num_inference_steps = 8;
  }

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Try one model across both SiliconFlow hosts. Returns a URL or an Error. */
async function attemptGenerate(
  model: string,
  apiKey: string,
  prompt: string,
  options: GenerateImageOptions
): Promise<{ url?: string; error?: Error }> {
  let lastError: Error | undefined;
  for (let i = 0; i < SILICONFLOW_IMAGE_URLS.length; i++) {
    let response: Response;
    try {
      response = await postSiliconFlowImage(SILICONFLOW_IMAGE_URLS[i], apiKey, model, prompt, options);
    } catch {
      lastError = new Error("Could not reach the image generation service. Please try again.");
      continue;
    }

    let json: SiliconFlowImageResponse | null = null;
    try {
      json = (await response.json()) as SiliconFlowImageResponse;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const detail = json?.error?.message ?? json?.message;
      // Log the real upstream failure (status + model + body) so the cause is
      // visible in server logs instead of hidden behind a friendly message.
      console.error(
        `[siliconflow] image generation failed: status=${response.status} ` +
          `model=${model} host=${SILICONFLOW_IMAGE_URLS[i]} detail=${detail ?? "(no body)"}`
      );
      lastError = friendlySiliconFlowError(response.status, detail);
      // The China host can serve a key the global host rejects — retry there.
      if (response.status === 401 && i < SILICONFLOW_IMAGE_URLS.length - 1) continue;
      return { error: lastError };
    }

    const imageUrl = json ? firstImageUrl(json) : undefined;
    if (!imageUrl) return { error: new Error("Image generation didn't return an image. Please try again.") };
    return { url: imageUrl };
  }

  return { error: lastError ?? new Error("Image generation failed. Please try again.") };
}

export interface GenerateImageResult {
  url: string;
  /** True when the premium model failed and we served Z-Image-Turbo instead. */
  fellBack: boolean;
}

export async function generateImage(
  prompt: string,
  options: GenerateImageOptions = {}
): Promise<GenerateImageResult> {
  const apiKey = siliconFlowApiKey();
  if (!apiKey) throw new Error("Image generation is not configured.");

  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error("Image generation needs a prompt.");
  const mode = options.mode ?? "generate";
  if (mode === "edit" && !options.inputImageBase64) {
    throw new Error("Image editing needs an attached image.");
  }

  const primaryModel = imageModelForPlan(options.plan, mode);
  const primary = await attemptGenerate(primaryModel, apiKey, cleanPrompt, options);
  if (primary.url) return { url: primary.url, fellBack: false };

  // SiliconFlow's premium FLUX models (FLUX.2-pro for Max/Ultra) have
  // intermittent outages — failing even in SiliconFlow's own playground while
  // Z-Image-Turbo keeps working. For text-to-image, fall back to Z-Image-Turbo
  // so Max/Ultra users still get an image. No fallback for edits: Z-Image-Turbo
  // can't edit an attached image.
  if (mode === "generate" && primaryModel !== SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL) {
    console.error(
      `[siliconflow] ${primaryModel} unavailable; falling back to ${SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL}`
    );
    const fallback = await attemptGenerate(
      SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL,
      apiKey,
      cleanPrompt,
      options
    );
    if (fallback.url) return { url: fallback.url, fellBack: true };
  }

  throw primary.error ?? new Error("Image generation failed. Please try again.");
}

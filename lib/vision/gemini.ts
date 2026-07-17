import "server-only";

import type { ImageMimeType } from "@/lib/data/types";

interface GeminiGenerateContentResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface VisionImage {
  base64: string;
  mimeType: ImageMimeType;
}

function buildVisionPrompt(
  userMessage: string,
  count: number,
  kind: "image" | "document"
): string {
  if (kind === "document") {
    return [
      `The following ${count} image(s) are the rendered pages of a scanned document the user attached.`,
      "Transcribe ALL text exactly as written, in reading order, and describe any tables, figures, diagrams, stamps, signatures, or handwriting. Preserve structure (headings, lists, tables) using plain text / markdown.",
      `The user's message about this document is: ${userMessage}`,
    ].join("\n");
  }
  const subject = count > 1 ? `these ${count} images` : "this image";
  return [
    `Describe ${subject} in complete detail for an AI assistant that cannot see images.`,
    "For each image include: all visible text exactly as written, every object and element present, colors and visual style, layout and spatial relationships, any data or numbers if it is a chart or graph, any code if it is a screenshot of code, any error messages if visible, and anything else that would help an AI understand and respond to questions about it.",
    count > 1 ? "Clearly label each image (Image 1, Image 2, …)." : "",
    `The user's message about ${count > 1 ? "these images" : "this image"} is: ${userMessage}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Provider secrecy: these errors can reach the client verbatim (the chat route
// forwards err.message), so they must never name the underlying vendor or
// forward raw upstream error text. The raw detail is logged server-side only.
function errorForStatus(status: number, detail?: string): Error {
  if (detail) console.error("[vision] upstream error", status, detail);
  if (status === 400) {
    return new Error("Forge couldn't analyze this image. Check that the image is valid and try again.");
  }
  if (status === 403) {
    return new Error("Image understanding isn't fully configured on this deployment.");
  }
  if (status === 429) {
    return new Error("Image analysis is rate limited right now. Please try again shortly.");
  }
  return new Error("Image analysis failed. Please try again.");
}

/**
 * Analyze one or more images in a single Gemini call and return a text
 * description for the (text-only) chat model. `kind: "document"` switches the
 * prompt to OCR/transcription mode for rendered scanned-PDF pages.
 */
export async function analyzeImages(
  images: VisionImage[],
  userMessage: string,
  kind: "image" | "document" = "image"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Image understanding is not configured.");
  if (images.length === 0) throw new Error("No image to analyze.");

  const url = new URL(GEMINI_ENDPOINT);
  url.searchParams.set("key", apiKey);

  const parts = [
    ...images.map((img) => ({
      inline_data: { mime_type: img.mimeType, data: img.base64 },
    })),
    { text: buildVisionPrompt(userMessage, images.length, kind) },
  ];

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
  } catch {
    throw new Error("Could not reach the image analysis service. Please try again.");
  }

  let json: GeminiGenerateContentResponse | null = null;
  try {
    json = (await response.json()) as GeminiGenerateContentResponse;
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw errorForStatus(response.status, json?.error?.message);
  }

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error("Forge couldn't produce an image description. Please try again.");
  }

  return text;
}

export async function analyzeImage(
  imageBase64: string,
  mimeType: ImageMimeType,
  userMessage: string
): Promise<string> {
  return analyzeImages([{ base64: imageBase64, mimeType }], userMessage, "image");
}
